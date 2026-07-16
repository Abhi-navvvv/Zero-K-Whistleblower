import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import * as jose from "jose";
import {
  generateBlindSignKey,
  b64urlToBigInt,
  modPow,
  type BlindKeyJWK
} from "@zk-whistleblower/shared/src/blindSign";
import { getCurrentEpoch } from "@zk-whistleblower/shared/src/epoch";

export const runtime = "nodejs";

const STORAGE_DIR = path.join(process.cwd(), "data");

function getStoragePath(filename: string): string {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
  return path.join(STORAGE_DIR, filename);
}

interface KeyPairFile {
  publicKey: BlindKeyJWK;
  privateKey: BlindKeyJWK;
}

function getOrGenerateKeyPair(): KeyPairFile {
  const keyPath = getStoragePath("blind-sign-key.json");
  if (fs.existsSync(keyPath)) {
    try {
      return JSON.parse(fs.readFileSync(keyPath, "utf-8")) as KeyPairFile;
    } catch (e) {
      console.error("Failed to parse blind-sign-key.json, regenerating:", e);
    }
  }

  const keys = generateBlindSignKey();
  fs.writeFileSync(keyPath, JSON.stringify(keys, null, 2), "utf-8");
  return keys;
}

function getIssuedSignatures(): Record<string, boolean> {
  const sigPath = getStoragePath("issued-signatures.json");
  if (fs.existsSync(sigPath)) {
    try {
      return JSON.parse(fs.readFileSync(sigPath, "utf-8")) as Record<string, boolean>;
    } catch {
      return {};
    }
  }
  return {};
}

function recordIssuedSignature(key: string) {
  const sigPath = getStoragePath("issued-signatures.json");
  const sigs = getIssuedSignatures();
  sigs[key] = true;
  fs.writeFileSync(sigPath, JSON.stringify(sigs, null, 2), "utf-8");
}

export async function GET() {
  try {
    const keys = getOrGenerateKeyPair();
    return NextResponse.json({
      n: keys.publicKey.n,
      e: keys.publicKey.e,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { idToken, jwksUri, blindedNullifier, orgId } = body;

    if (!idToken || !jwksUri || !blindedNullifier || orgId === undefined) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // 1. Verify OIDC ID Token
    let absoluteJwksUri = jwksUri;
    if (jwksUri.startsWith("/")) {
      const origin = req.nextUrl.origin || `http://${req.headers.get("host") || "localhost:3001"}`;
      absoluteJwksUri = `${origin}${jwksUri}`;
    }

    let email: string;
    try {
      const JWKS = jose.createRemoteJWKSet(new URL(absoluteJwksUri));
      const { payload } = await jose.jwtVerify(idToken, JWKS);
      email = (payload.email as string) || "";
    } catch (err: unknown) {
      return NextResponse.json(
        { error: `OIDC verification failed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 401 }
      );
    }

    const domain = email.split("@")[1] || "";
    if (!email || !domain) {
      return NextResponse.json({ error: "OIDC token missing email claim" }, { status: 400 });
    }

    // 2. Validate Domain Constraint
    const allowedDomain = process.env.NEXT_PUBLIC_ALLOWED_OIDC_DOMAIN || "bennett.edu.in";
    if (allowedDomain && domain !== allowedDomain) {
      return NextResponse.json(
        { error: `Domain mismatch: Only @${allowedDomain} accounts are authorized` },
        { status: 403 }
      );
    }

    // 3. Double-Signing Prevention Check (Epoch-based)
    const epoch = getCurrentEpoch();
    const uniqueClaimKey = `${orgId}:${email.toLowerCase()}:${epoch}`;
    const sigs = getIssuedSignatures();
    if (sigs[uniqueClaimKey]) {
      return NextResponse.json(
        { error: "You have already claimed an anonymous credential for this epoch." },
        { status: 429 }
      );
    }

    // 4. RSA Blind Signing
    const keys = getOrGenerateKeyPair();
    const N = b64urlToBigInt(keys.privateKey.n);
    const d = b64urlToBigInt(keys.privateKey.d!);

    const message = BigInt("0x" + blindedNullifier);
    if (message >= N) {
      return NextResponse.json({ error: "Blinded nullifier is out of RSA range" }, { status: 400 });
    }

    const blindedSignature = modPow(message, d, N);

    // Record that this OIDC user has received their signature for the epoch
    recordIssuedSignature(uniqueClaimKey);

    return NextResponse.json({
      blindedSignature: blindedSignature.toString(16),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
