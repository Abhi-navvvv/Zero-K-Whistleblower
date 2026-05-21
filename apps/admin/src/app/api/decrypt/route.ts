import { NextRequest, NextResponse } from "next/server";
import { decryptReportWithOrgPrivateKey, type EncryptedBlob, type PublicKeyEncryptedBlob } from "@zk-whistleblower/shared/src/encryption";
import { getOrgPrivateKeyConfig } from "@zk-whistleblower/shared/src/orgKeys";
import { decryptFile, isReportManifest, type EncryptedFileBlob } from "@zk-whistleblower/shared/src/fileEncryption";
import { type ReportManifest } from "@zk-whistleblower/shared/src/fileEncryption";
import { deriveThreadId } from "@zk-whistleblower/shared/src/messaging";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";

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

function normalizeCid(input: string): string {
  const raw = input.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) return raw;

  try {
    const hex = raw.slice(2);
    const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []);
    const decoded = new TextDecoder().decode(bytes).replace(/\u0000+$/g, "").trim();
    return decoded || raw;
  } catch {
    return raw;
  }
}

function validateCid(cid: string): boolean {
  return /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/.test(cid);
}

function isV2Blob(blob: EncryptedBlob): blob is PublicKeyEncryptedBlob {
  return (
    (blob as PublicKeyEncryptedBlob).v === 2 &&
    typeof (blob as PublicKeyEncryptedBlob).wrappedKey === "string" &&
    typeof (blob as PublicKeyEncryptedBlob).ciphertext === "string" &&
    typeof (blob as PublicKeyEncryptedBlob).nonce === "string"
  );
}

function isFileBlob(blob: unknown): blob is EncryptedFileBlob {
  return (
    typeof blob === "object" &&
    blob !== null &&
    (blob as EncryptedFileBlob).type === "file" &&
    (blob as EncryptedFileBlob).v === 2
  );
}

async function fetchIPFS<T = unknown>(cid: string): Promise<T> {
  const res = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`);
  if (!res.ok) {
    throw new Error(`IPFS fetch failed (${res.status}): ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// --- In-memory rate limiter (per-IP, sliding window) ---
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 20;
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

export async function POST(req: NextRequest) {
  try {
    // --- Rate limiting ---
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (isRateLimited(clientIp)) {
      return NextResponse.json(
        { error: "Rate limit exceeded — too many requests. Try again shortly." },
        { status: 429 }
      );
    }

    // --- Reviewer API key authentication (fail-closed) ---
    const expectedKey = process.env.REVIEWER_API_KEY;
    if (!expectedKey) {
      return NextResponse.json(
        { error: "Server misconfiguration — REVIEWER_API_KEY not set. Contact administrator." },
        { status: 500 }
      );
    }
    const providedKey = req.headers.get("x-api-key");
    if (!safeCompare(providedKey, expectedKey)) {
      return NextResponse.json(
        { error: "Unauthorized — provide a valid reviewer API key to decrypt reports" },
        { status: 401 }
      );
    }

    const body = (await req.json()) as {
      cid?: string;
      orgId?: number;
      fileIndex?: number; // optional: decrypt a specific file from a manifest
    };
    if (typeof body.cid !== "string" || !body.cid.trim()) {
      return NextResponse.json({ error: "Missing CID" }, { status: 400 });
    }

    const orgId = Number(body.orgId ?? 0);
    if (!Number.isFinite(orgId) || orgId < 0) {
      return NextResponse.json({ error: "Invalid orgId" }, { status: 400 });
    }

    const cid = normalizeCid(body.cid);
    if (!validateCid(cid)) {
      return NextResponse.json({ error: "Invalid CID format" }, { status: 400 });
    }

    const ipfsData = await fetchIPFS<unknown>(cid);
    const { keyB64 } = getOrgPrivateKeyConfig(orgId);

    // Case 1: It's a manifest with text + file attachments
    if (isReportManifest(ipfsData)) {
      const manifest = ipfsData as ReportManifest;

      // If a specific file index is requested, decrypt that file
      if (typeof body.fileIndex === "number") {
        const fi = body.fileIndex;
        if (fi < 0 || fi >= manifest.files.length) {
          return NextResponse.json({ error: "File index out of range" }, { status: 400 });
        }
        const fileMeta = manifest.files[fi];
        const encryptedFile = await fetchIPFS<EncryptedFileBlob>(fileMeta.cid);
        if (!isFileBlob(encryptedFile)) {
          return NextResponse.json({ error: "File CID did not resolve to an encrypted file blob" }, { status: 400 });
        }
        const { data, filename, mimeType } = await decryptFile(encryptedFile, keyB64);
        // Return file as base64 since Next.js API routes work best with JSON
        const base64 = Buffer.from(data).toString("base64");
        return NextResponse.json({ filename, mimeType, base64 });
      }

      // Otherwise decrypt the text report and return manifest metadata
      const textCid = normalizeCid(manifest.textCid);
      if (!validateCid(textCid)) {
        return NextResponse.json({ error: "Invalid text CID in manifest" }, { status: 400 });
      }
      const textBlob = await fetchIPFS<EncryptedBlob>(textCid);
      if (!isV2Blob(textBlob)) {
        return NextResponse.json(
          { error: "Text report uses legacy v1 encryption, cannot decrypt with org key." },
          { status: 400 }
        );
      }
      const plaintext = await decryptReportWithOrgPrivateKey(textBlob, keyB64);

      return NextResponse.json({
        plaintext,
        manifest: true,
        files: manifest.files.map((f, i) => ({
          index: i,
          filename: f.filename,
          mimeType: f.mimeType,
          originalSize: f.originalSize,
        })),
        ...(manifest.recipient && { recipient: manifest.recipient }),
        ...(manifest.commKey && { commKey: manifest.commKey }),
        ...(manifest.commKey && { threadId: await deriveThreadId(manifest.commKey) }),
      });
    }

    // Case 2: It's a direct encrypted file blob
    if (isFileBlob(ipfsData)) {
      const { data, filename, mimeType } = await decryptFile(ipfsData as EncryptedFileBlob, keyB64);
      const base64 = Buffer.from(data).toString("base64");
      return NextResponse.json({ filename, mimeType, base64 });
    }

    // Case 3: It's a regular v2 text report (no manifest)
    const blob = ipfsData as EncryptedBlob;
    if (!isV2Blob(blob)) {
      return NextResponse.json(
        {
          error:
            "This report uses legacy password encryption (v1). Public-key decryption supports v2 reports only.",
        },
        { status: 400 }
      );
    }

    const plaintext = await decryptReportWithOrgPrivateKey(blob, keyB64);
    return NextResponse.json({ plaintext });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to decrypt report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}