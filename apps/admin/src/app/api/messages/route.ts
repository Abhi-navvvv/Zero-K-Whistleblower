import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

/**
 * Anonymous messaging API.
 *
 * GET  /api/messages?nullifier=<hash>   → returns all messages for that mailbox
 * POST /api/messages { nullifierHash, message }  → appends a message
 *
 * Messages are stored as JSON files under .messages/<hash>.json.
 * The admin API key is required for POST (admin replies).
 * GET is open — the whistleblower fetches their messages anonymously.
 * Messages are encrypted client-side with the shared commKey.
 *
 * Note: In serverless environments (Vercel), filesystem writes to ephemeral /tmp are used.
 * For production deployments, consider migrating to Vercel KV or a database.
 */

export const runtime = "nodejs";

const MESSAGES_DIR = path.join("/tmp", ".messages");

interface EncryptedMessage {
  from: "admin" | "reporter";
  nonce: string;
  ciphertext: string;
  timestamp: string;
}

async function ensureDir() {
  try {
    await fs.mkdir(MESSAGES_DIR, { recursive: true });
  } catch (err) {
    // In serverless environments, /tmp may have restrictions
    // Log but don't fail - messages can still be stored temporarily
    if (process.env.NODE_ENV === "development") {
      console.error("Failed to create messages directory:", err);
    }
  }
}

function sanitizeHash(hash: string): string {
  // Only allow digits (nullifierHash is a decimal bigint string)
  return hash.replace(/[^0-9]/g, "");
}

function messageFilePath(nullifierHash: string): string {
  return path.join(MESSAGES_DIR, `${sanitizeHash(nullifierHash)}.json`);
}

async function readMessages(nullifierHash: string): Promise<EncryptedMessage[]> {
  try {
    await ensureDir();
    const data = await fs.readFile(messageFilePath(nullifierHash), "utf-8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeMessages(nullifierHash: string, messages: EncryptedMessage[]): Promise<void> {
  await ensureDir();
  await fs.writeFile(messageFilePath(nullifierHash), JSON.stringify(messages, null, 2));
}

function addCorsHeaders(response: NextResponse): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  return response;
}

// ─── OPTIONS: Handle CORS preflight requests ──────────────────────────────────

export async function OPTIONS() {
  return addCorsHeaders(NextResponse.json({ ok: true }));
}

// ─── GET: Fetch messages for a nullifierHash ─────────────────────────────────

export async function GET(req: NextRequest) {
  const nullifier = req.nextUrl.searchParams.get("nullifier");
  if (!nullifier?.trim()) {
    return addCorsHeaders(NextResponse.json({ error: "Missing nullifier parameter" }, { status: 400 }));
  }

  const messages = await readMessages(nullifier.trim());
  return addCorsHeaders(NextResponse.json({ messages, count: messages.length }));
}

// ─── POST: Add a message to a nullifierHash's thread ─────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      nullifierHash?: string;
      message?: EncryptedMessage;
    };

    if (!body.nullifierHash?.trim()) {
      return addCorsHeaders(NextResponse.json({ error: "Missing nullifierHash" }, { status: 400 }));
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

    const nullifierHash = body.nullifierHash.trim();
    const existing = await readMessages(nullifierHash);

    // Cap at 100 messages per thread to prevent abuse
    if (existing.length >= 100) {
      return addCorsHeaders(NextResponse.json(
        { error: "Message thread is full (max 100 messages)" },
        { status: 429 }
      ));
    }

    existing.push({
      from: body.message.from,
      nonce: body.message.nonce,
      ciphertext: body.message.ciphertext,
      timestamp: body.message.timestamp || new Date().toISOString(),
    });

    await writeMessages(nullifierHash, existing);

    return addCorsHeaders(NextResponse.json({ ok: true, count: existing.length }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process message";
    return addCorsHeaders(NextResponse.json({ error: message }, { status: 500 }));
  }
}
