import crypto from "crypto";
import { gcd, type BlindKeyJWK } from "./blindSignMath";

export * from "./blindSignMath";

export function generateBlindSignKey(): { publicKey: BlindKeyJWK; privateKey: BlindKeyJWK } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const pubJWK = publicKey.export({ format: "jwk" }) as BlindKeyJWK;
  const privJWK = privateKey.export({ format: "jwk" }) as BlindKeyJWK;
  return { publicKey: pubJWK, privateKey: privJWK };
}

export function generateBlindingFactor(N: bigint): bigint {
  const bytes = new Uint8Array(256); // 2048 bits
  let r = 0n;
  while (true) {
    crypto.getRandomValues(bytes);
    r = BigInt("0x" + Buffer.from(bytes).toString("hex")) % N;
    if (r > 1n && gcd(r, N) === 1n) {
      return r;
    }
  }
}
