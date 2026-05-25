import { NextResponse } from "next/server";
import crypto from "crypto";

// Generate a static RSA keypair for token signing
// In a dev environment, we can generate a persistent keypair in-memory
let privateKeyPem: string;
let publicKeyJwk: crypto.JsonWebKey;
const KID = "mock-oidc-key-id-1";

try {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  privateKeyPem = privateKey;
  const pubKeyObject = crypto.createPublicKey(publicKey);
  publicKeyJwk = pubKeyObject.export({ format: "jwk" });
  publicKeyJwk.kid = KID;
  publicKeyJwk.use = "sig";
  publicKeyJwk.alg = "RS256";
} catch (err) {
  console.error("Failed to generate RSA keypair for mock OIDC:", err);
}

function base64UrlEncode(str: string | Buffer): string {
  const buffer = typeof str === "string" ? Buffer.from(str) : str;
  return buffer.toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// GET: Expose JWKS (JSON Web Key Set) endpoint
export async function GET() {
  if (!publicKeyJwk) {
    return NextResponse.json({ error: "JWK not initialized" }, { status: 500 });
  }
  return NextResponse.json({
    keys: [publicKeyJwk],
  });
}

// POST: Issue a signed ID Token (JWT)
export async function POST(req: Request) {
  try {
    const { email, nonce } = await req.json();
    if (!email || !nonce) {
      return NextResponse.json({ error: "Missing email or nonce" }, { status: 400 });
    }

    const domain = email.split("@")[1];
    if (!domain) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    // Construct Header
    const header = {
      alg: "RS256",
      typ: "JWT",
      kid: KID,
    };

    // Construct Payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: "https://accounts.google.com",
      sub: crypto.createHash("sha256").update(email).digest("hex"),
      email: email,
      email_verified: true,
      nonce: nonce,
      aud: "mock-client-id-12345",
      iat: now,
      exp: now + 3600, // 1 hour expiration
    };

    // Encode Header & Payload
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // Sign using RSA Private Key
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(signingInput);
    const signature = sign.sign(privateKeyPem);
    const encodedSignature = base64UrlEncode(signature);

    const token = `${signingInput}.${encodedSignature}`;

    return NextResponse.json({
      id_token: token,
      jwks_uri: "/api/mock-oidc",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
