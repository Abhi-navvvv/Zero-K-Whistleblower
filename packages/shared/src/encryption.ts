// Browser/server encryption helpers.
// Envelope encryption (AES-GCM + RSA-OAEP key wrapping)

export interface PublicKeyEncryptedBlob {
  v: 2;
  alg: "AES-256-GCM+RSA-OAEP-256";
  orgId: number;
  keyVersion: number;
  nonce: string;      // base64, 12-byte AES-GCM nonce
  ciphertext: string; // base64, AES-GCM ciphertext + tag
  wrappedKey: string; // base64, RSA-OAEP wrapped 32-byte AES key
}

export type EncryptedBlob = PublicKeyEncryptedBlob;

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  if (typeof btoa !== "function") {
    return Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf).toString("base64");
  }
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  // Process in chunks so we don't blow the call stack on large ciphertexts
  let str = "";
  for (let i = 0; i < bytes.length; i += 4096) {
    str += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return btoa(str);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof atob !== "function") {
    const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
    return bytes as Uint8Array<ArrayBuffer>;
  }
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

function sanitizeB64(input: string): string {
  return input.replace(/\s+/g, "").trim();
}

async function importRsaPublicKey(publicKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    fromBase64(sanitizeB64(publicKeyB64)),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
}

async function importRsaPrivateKey(privateKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    fromBase64(sanitizeB64(privateKeyB64)),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
}

export async function encryptReportForOrgPublicKey(
  plaintext: string,
  orgId: number,
  publicKeyB64: string,
  keyVersion = 1
): Promise<PublicKeyEncryptedBlob> {
  const enc = new TextEncoder();
  const nonce = new Uint8Array(new ArrayBuffer(12)) as Uint8Array<ArrayBuffer>;
  const dataKeyBytes = new Uint8Array(new ArrayBuffer(32)) as Uint8Array<ArrayBuffer>;
  crypto.getRandomValues(nonce);
  crypto.getRandomValues(dataKeyBytes);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    dataKeyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    enc.encode(plaintext)
  );

  const rsaPublicKey = await importRsaPublicKey(publicKeyB64);
  const wrappedKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaPublicKey,
    dataKeyBytes
  );

  return {
    v: 2,
    alg: "AES-256-GCM+RSA-OAEP-256",
    orgId,
    keyVersion,
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
    wrappedKey: toBase64(wrappedKey),
  };
}

export async function decryptReportWithOrgPrivateKey(
  blob: PublicKeyEncryptedBlob,
  privateKeyB64: string
): Promise<string> {
  const nonce = fromBase64(blob.nonce);
  const ciphertext = fromBase64(blob.ciphertext);
  const wrappedKey = fromBase64(blob.wrappedKey);

  const rsaPrivateKey = await importRsaPrivateKey(privateKeyB64);
  const dataKeyBytes = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    rsaPrivateKey,
    wrappedKey
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    dataKeyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}
