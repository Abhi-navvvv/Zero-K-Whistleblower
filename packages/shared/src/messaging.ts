/**
 * Anonymous two-way messaging primitives.
 *
 * Uses the whistleblower's secret to deterministically derive:
 *  - A communication key (commKey) for encrypting/decrypting messages
 *  - The nullifierHash which acts as the mailbox address
 *
 * The commKey is embedded inside the encrypted report manifest so the admin
 * can extract it after decryption. Both sides can then exchange AES-256-GCM
 * encrypted messages keyed by the nullifierHash.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EncryptedMessage {
  from: "admin" | "reporter";
  nonce: string;      // base64, 12-byte IV
  ciphertext: string; // base64, AES-GCM ciphertext + tag
  timestamp: string;  // ISO-8601
}

export interface MessageThread {
  nullifierHash: string;
  messages: EncryptedMessage[];
}

// ─── CommKey derivation ──────────────────────────────────────────────────────

/**
 * Derives a 32-byte AES key from the whistleblower's secret.
 * This key is shared between whistleblower and admin for message encryption.
 *
 * The derivation is deterministic: same secret → same commKey.
 * The admin gets this key from the decrypted report manifest.
 */
export async function deriveCommKey(secret: bigint): Promise<string> {
  const encoder = new TextEncoder();
  const material = encoder.encode("zk-comm:" + secret.toString());
  const hashBuf = await crypto.subtle.digest("SHA-256", material);
  // Return as hex string for easy serialization
  const bytes = new Uint8Array(hashBuf);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Derives a stable message-thread identifier from the shared commKey.
 * The thread ID is what gets stored in the database and used to fetch messages.
 */
export async function deriveThreadId(commKeyHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const material = encoder.encode("zk-thread:" + commKeyHex.toLowerCase());
  const hashBuf = await crypto.subtle.digest("SHA-256", material);
  const bytes = new Uint8Array(hashBuf);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Import a hex commKey string into a CryptoKey for AES-GCM operations.
 */
async function importCommKey(commKeyHex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(
    commKeyHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16))
  );
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ─── Message encryption / decryption ─────────────────────────────────────────

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let str = "";
  for (let i = 0; i < bytes.length; i += 4096) {
    str += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return btoa(str);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/**
 * Encrypt a plaintext message using the shared commKey.
 */
export async function encryptMessage(
  commKeyHex: string,
  plaintext: string,
  from: "admin" | "reporter"
): Promise<EncryptedMessage> {
  const key = await importCommKey(commKeyHex);
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    encoder.encode(plaintext)
  );
  return {
    from,
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Decrypt a message using the shared commKey.
 */
export async function decryptMessage(
  commKeyHex: string,
  msg: EncryptedMessage
): Promise<string> {
  const key = await importCommKey(commKeyHex);
  const nonce = fromBase64(msg.nonce);
  const ciphertext = fromBase64(msg.ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

// ─── API helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch messages for a given thread ID from the messages API.
 */
export async function fetchMessages(
  baseUrl: string,
  threadId: string
): Promise<EncryptedMessage[]> {
  const res = await fetch(
    `${baseUrl}/api/messages?threadId=${encodeURIComponent(threadId)}`
  );
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Failed to fetch messages: ${res.statusText}`);
  }
  const data = await res.json() as { messages: EncryptedMessage[] };
  return data.messages ?? [];
}

export async function fetchThreadSummary(
  baseUrl: string,
  threadId: string
): Promise<{ status?: string; messageCount?: number } | null> {
  const res = await fetch(
    `${baseUrl}/api/messages?threadId=${encodeURIComponent(threadId)}`
  );
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Failed to fetch thread summary: ${res.statusText}`);
  }
  const data = await res.json() as { thread?: { status?: string; messageCount?: number } };
  return data.thread ?? null;
}

/**
 * Post an encrypted message for a given thread ID.
 */
export async function postMessage(
  baseUrl: string,
  threadId: string,
  message: EncryptedMessage,
  apiKey?: string
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const res = await fetch(`${baseUrl}/api/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ threadId, message }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `Failed to post message: ${res.statusText}`);
  }
}

export async function updateThreadState(
  baseUrl: string,
  threadId: string,
  action: "markRead" | "archive" | "restore",
  options?: { sender?: "admin" | "reporter"; apiKey?: string }
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.apiKey) headers["x-api-key"] = options.apiKey;

  const res = await fetch(`${baseUrl}/api/messages`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      threadId,
      action,
      ...(options?.sender ? { sender: options.sender } : {}),
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `Failed to update thread: ${res.statusText}`);
  }
}
