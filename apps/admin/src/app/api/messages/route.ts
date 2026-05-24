import { NextRequest, NextResponse } from "next/server";
import { appendMessage, archiveThread, getThreadSummary, listMessages, markThreadMessagesRead, restoreThread } from "@zk-whistleblower/db";
import { timingSafeEqual } from "crypto";

/**
 * Helper to safely compare strings in constant time to prevent timing attacks
 */
function safeCompare(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch (e) {
    return false;
  }
}

/**
 * Anonymous messaging API.
 *
 * GET  /api/messages?threadId=<hash>   → returns all messages for that thread
 * POST /api/messages { threadId, message }  → appends a message
 *
 * Messages are stored in Postgres via Prisma.
 * The admin API key is required for POST (admin replies).
 * GET is open — the whistleblower fetches their messages anonymously.
 * Messages are encrypted client-side with the shared commKey.
 */

export const runtime = "nodejs";

interface EncryptedMessage {
  from: "admin" | "reporter";
  nonce: string;
  ciphertext: string;
  timestamp: string;
}

function normalizeThreadId(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function addCorsHeaders(response: NextResponse, req?: NextRequest): NextResponse {
  // Try to use the requesting origin if it's not null, otherwise fallback to reporter app URL or localhost
  const origin = req?.headers.get("origin") || process.env.NEXT_PUBLIC_REPORTER_URL || "http://localhost:3001";
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  return response;
}

// ─── OPTIONS: Handle CORS preflight requests ──────────────────────────────────

export async function OPTIONS(req: NextRequest) {
  return addCorsHeaders(NextResponse.json({ ok: true }), req);
}

// --- In-memory rate limiter (per-IP, sliding window) ---
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // Higher limit for messages
const rateLimitMap = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) return true;
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return false;
}

// ─── GET: Fetch messages for a nullifierHash ─────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    // --- Rate limiting ---
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (isRateLimited(clientIp)) {
      return addCorsHeaders(NextResponse.json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429 }), req);
    }

    const threadId = normalizeThreadId(req.nextUrl.searchParams.get("threadId") ?? req.nextUrl.searchParams.get("nullifier"));
    if (!threadId) {
      return addCorsHeaders(NextResponse.json({ error: "Missing threadId parameter" }, { status: 400 }), req);
    }

    const [messages, thread] = await Promise.all([listMessages(threadId), getThreadSummary(threadId)]);
    return addCorsHeaders(NextResponse.json({
      messages,
      count: messages.length,
      thread: thread
        ? {
          id: thread.id,
          status: thread.status,
          lastMessageAt: thread.lastMessageAt,
          archivedAt: thread.archivedAt,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          messageCount: thread._count.messages,
        }
        : {
          id: threadId,
          status: "ACTIVE",
          lastMessageAt: null,
          archivedAt: null,
          createdAt: null,
          updatedAt: null,
          messageCount: 0,
        },
    }), req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch messages";
    return addCorsHeaders(NextResponse.json({ error: message }, { status: 500 }), req);
  }
}

// ─── POST: Add a message to a nullifierHash's thread ─────────────────────────

export async function POST(req: NextRequest) {
  try {
    // --- Rate limiting ---
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (isRateLimited(clientIp)) {
      return addCorsHeaders(NextResponse.json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429 }), req);
    }

    const body = (await req.json()) as {
      threadId?: string;
      nullifierHash?: string;
      message?: EncryptedMessage;
    };

    const threadId = normalizeThreadId(body.threadId ?? body.nullifierHash);
    if (!threadId) {
      return addCorsHeaders(NextResponse.json({ error: "Missing threadId" }, { status: 400 }), req);
    }
    if (!body.message || !body.message.ciphertext || !body.message.nonce) {
      return addCorsHeaders(NextResponse.json({ error: "Invalid message payload" }, { status: 400 }), req);
    }

    // Validate the sender type
    const from = body.message.from;
    if (from !== "admin" && from !== "reporter") {
      return addCorsHeaders(NextResponse.json({ error: "Invalid sender type" }, { status: 400 }), req);
    }

    // Admin messages require API key authentication
    if (from === "admin") {
      const expectedKey = process.env.REVIEWER_API_KEY;
      if (!expectedKey) {
        return addCorsHeaders(NextResponse.json(
          { error: "Server misconfiguration \u2014 REVIEWER_API_KEY not set" },
          { status: 500 }
        ), req);
      }
      
      const providedKey = req.headers.get("x-api-key");
      if (!safeCompare(providedKey, expectedKey)) {
        return addCorsHeaders(NextResponse.json(
          { error: "Unauthorized \u2014 admin messages require a valid API key" },
          { status: 401 }
        ), req);
      }
    }

    await appendMessage(threadId, {
      from: body.message.from,
      nonce: body.message.nonce,
      ciphertext: body.message.ciphertext,
      timestamp: body.message.timestamp || new Date().toISOString(),
    });

    const messages = await listMessages(threadId);
    return addCorsHeaders(NextResponse.json({ ok: true, count: messages.length }), req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process message";
    return addCorsHeaders(NextResponse.json({ error: message }, { status: 500 }), req);
  }
}

// ─── PATCH: Message/read state and thread lifecycle ────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    // --- Rate limiting ---
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (isRateLimited(clientIp)) {
      return addCorsHeaders(NextResponse.json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429 }), req);
    }

    const body = (await req.json()) as {
      threadId?: string;
      action?: "markRead" | "archive" | "restore";
      sender?: "admin" | "reporter";
    };

    const threadId = normalizeThreadId(body.threadId);
    if (!threadId) {
      return addCorsHeaders(NextResponse.json({ error: "Missing threadId" }, { status: 400 }), req);
    }

    if (body.action === "markRead") {
      if (body.sender !== "admin" && body.sender !== "reporter") {
        return addCorsHeaders(NextResponse.json({ error: "Missing sender for read receipt" }, { status: 400 }), req);
      }
      const count = await markThreadMessagesRead(threadId, body.sender);
      return addCorsHeaders(NextResponse.json({ ok: true, updated: count }), req);
    }

    const providedKey = req.headers.get("x-api-key");
    const expectedKey = process.env.REVIEWER_API_KEY;
    if (!expectedKey || !safeCompare(providedKey, expectedKey)) {
      return addCorsHeaders(NextResponse.json({ error: "Unauthorized \u2014 thread lifecycle changes require a valid reviewer API key" }, { status: 401 }), req);
    }

    if (body.action === "archive") {
      await archiveThread(threadId);
      return addCorsHeaders(NextResponse.json({ ok: true, archived: true }), req);
    }

    if (body.action === "restore") {
      await restoreThread(threadId);
      return addCorsHeaders(NextResponse.json({ ok: true, archived: false }), req);
    }

    return addCorsHeaders(NextResponse.json({ error: "Invalid action" }, { status: 400 }), req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update thread";
    return addCorsHeaders(NextResponse.json({ error: message }, { status: 500 }), req);
  }
}
