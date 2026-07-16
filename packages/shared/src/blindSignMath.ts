export interface BlindKeyJWK {
  n: string;
  e: string;
  d?: string;
}

export function b64urlToBigInt(b64url: string): bigint {
  // Browser-safe base64url decoding
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  const padded = pad ? b64 + "=".repeat(4 - pad) : b64;
  const binary = atob(padded);
  let hex = "";
  for (let i = 0; i < binary.length; i++) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return BigInt("0x" + hex);
}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let res = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      res = (res * base) % mod;
    }
    base = (base * base) % mod;
    exp = exp / 2n;
  }
  return res;
}

export function gcd(a: bigint, b: bigint): bigint {
  while (b > 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

export function modInverse(a: bigint, m: bigint): bigint {
  let m0 = m;
  let y = 0n, x = 1n;
  if (m === 1n) return 0n;
  while (a > 1n) {
    let q = a / m;
    let t = m;
    m = a % m;
    a = t;
    t = y;
    y = x - q * y;
    x = t;
  }
  if (x < 0n) x += m0;
  return x;
}

export function generateBlindingFactorBrowser(N: bigint): bigint {
  const bytes = new Uint8Array(256); // 2048 bits
  let r = 0n;
  while (true) {
    window.crypto.getRandomValues(bytes);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    r = BigInt("0x" + hex) % N;
    if (r > 1n && gcd(r, N) === 1n) {
      return r;
    }
  }
}

export function blindMessage(message: bigint, r: bigint, e: bigint, N: bigint): bigint {
  const rToE = modPow(r, e, N);
  return (message * rToE) % N;
}

export function unblindSignature(blindedSignature: bigint, rInv: bigint, N: bigint): bigint {
  return (blindedSignature * rInv) % N;
}

export function verifySignature(signature: bigint, e: bigint, N: bigint, message: bigint): boolean {
  return modPow(signature, e, N) === message;
}
