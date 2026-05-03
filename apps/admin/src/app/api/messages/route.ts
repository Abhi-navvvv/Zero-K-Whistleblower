import { NextRequest, NextResponse } from "next/server";
import { appendMessage, archiveThread, getThreadSummary, listMessages, markThreadMessagesRead, restoreThread } from "@zk-whistleblower/db";

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

function addCorsHeaders(response: NextResponse): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  return response;
}

// ─── OPTIONS: Handle CORS preflight requests ──────────────────────────────────

export async function OPTIONS() {
  return addCorsHeaders(NextResponse.json({ ok: true }));
}

// ─── GET: Fetch messages for a nullifierHash ─────────────────────────────────

export async function GET(req: NextRequest) {
  const threadId = normalizeThreadId(req.nextUrl.searchParams.get("threadId") ?? req.nextUrl.searchParams.get("nullifier"));
  if (!threadId) {
    return addCorsHeaders(NextResponse.json({ error: "Missing threadId parameter" }, { status: 400 }));
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
  }));
}

// ─── POST: Add a message to a nullifierHash's thread ─────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      threadId?: string;
      nullifierHash?: string;
      message?: EncryptedMessage;
    };

    const threadId = normalizeThreadId(body.threadId ?? body.nullifierHash);
    if (!threadId) {
      return addCorsHeaders(NextResponse.json({ error: "Missing threadId" }, { status: 400 }));
    }
    if (!body.message || !body.message.ciphertext || !body.message.nonce) {
      return addCorsHeaders(NextResponse.json({ error: "Invalid message payload" }, { status: 400 }));
    }

    // Validate the sender type
    const from = body.message.from;
    if (from !== "admin" && from !== "reporter") {
      return addCorsHeaders(NextResponse.json({ error: "Invalid sender type" }, { status: 400 }));
    }

    // Admin messages require API key authentication
    if (from === "admin") {
      const expectedKey = process.env.REVIEWER_API_KEY;
      if (!expectedKey) {
        return addCorsHeaders(NextResponse.json(
          { error: "Server misconfiguration — REVIEWER_API_KEY not set" },
          { status: 500 }
        ));
      }
      const providedKey = req.headers.get("x-api-key");
      if (!providedKey || providedKey !== expectedKey) {
        return addCorsHeaders(NextResponse.json(
          { error: "Unauthorized — admin messages require a valid API key" },
          { status: 401 }
        ));
      }
    }

    await appendMessage(threadId, {
      from: body.message.from,
      nonce: body.message.nonce,
      ciphertext: body.message.ciphertext,
      timestamp: body.message.timestamp || new Date().toISOString(),
    });

    const messages = await listMessages(threadId);
    return addCorsHeaders(NextResponse.json({ ok: true, count: messages.length }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process message";
    return addCorsHeaders(NextResponse.json({ error: message }, { status: 500 }));
  }
}

// ─── PATCH: Message/read state and thread lifecycle ────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      threadId?: string;
      action?: "markRead" | "archive" | "restore";
      sender?: "admin" | "reporter";
    };

    const threadId = normalizeThreadId(body.threadId);
    if (!threadId) {
      return addCorsHeaders(NextResponse.json({ error: "Missing threadId" }, { status: 400 }));
    }

    if (body.action === "markRead") {
      if (body.sender !== "admin" && body.sender !== "reporter") {
        return addCorsHeaders(NextResponse.json({ error: "Missing sender for read receipt" }, { status: 400 }));
      }
      const count = await markThreadMessagesRead(threadId, body.sender);
      return addCorsHeaders(NextResponse.json({ ok: true, updated: count }));
    }

    const providedKey = req.headers.get("x-api-key");
    const expectedKey = process.env.REVIEWER_API_KEY;
    if (!expectedKey || !providedKey || providedKey !== expectedKey) {
      return addCorsHeaders(NextResponse.json({ error: "Unauthorized — thread lifecycle changes require a valid reviewer API key" }, { status: 401 }));
    }

    if (body.action === "archive") {
      await archiveThread(threadId);
      return addCorsHeaders(NextResponse.json({ ok: true, archived: true }));
    }

    if (body.action === "restore") {
      await restoreThread(threadId);
      return addCorsHeaders(NextResponse.json({ ok: true, archived: false }));
    }

    return addCorsHeaders(NextResponse.json({ error: "Invalid action" }, { status: 400 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update thread";
    return addCorsHeaders(NextResponse.json({ error: message }, { status: 500 }));
  }
}
