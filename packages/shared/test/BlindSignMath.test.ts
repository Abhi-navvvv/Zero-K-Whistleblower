import { expect } from "chai";
import {
    generateBlindSignKey,
    generateBlindingFactor,
    blindMessage,
    unblindSignature,
    verifySignature,
    modInverse,
    modPow,
    b64urlToBigInt
} from "../src/index.js";

describe("RSA Blind Signature Cryptographic Math", function () {
    it("should successfully blind, sign, unblind, and verify a message", function () {
        // 1. Generate Keypair
        const { publicKey, privateKey } = generateBlindSignKey();
        expect(publicKey.n).to.exist;
        expect(publicKey.e).to.exist;
        expect(privateKey.d).to.exist;

        const N = b64urlToBigInt(publicKey.n);
        const e = b64urlToBigInt(publicKey.e);
        const d = b64urlToBigInt(privateKey.d!);

        // 2. Prepare message (must be smaller than N)
        const message = 12345678901234567890n;
        expect(message).to.be.below(N);

        // 3. Generate blinding factor r
        const r = generateBlindingFactor(N);
        expect(r).to.be.below(N);

        // 4. Blind the message: m' = (m * r^e) mod N
        const blindedMessage = blindMessage(message, r, e, N);

        // 5. Sign the blinded message: s' = (m')^d mod N
        const blindedSignature = modPow(blindedMessage, d, N);

        // 6. Compute modular inverse of r: r^-1 mod N
        const rInv = modInverse(r, N);

        // 7. Unblind the signature: s = (s' * r^-1) mod N
        const signature = unblindSignature(blindedSignature, rInv, N);

        // 8. Verify the unblinded signature: s^e mod N === m
        const isValid = verifySignature(signature, e, N, message);
        expect(isValid).to.be.true;

        // 9. Verify invalid signature fails
        const badSignature = signature + 1n;
        const isBadValid = verifySignature(badSignature, e, N, message);
        expect(isBadValid).to.be.false;
    });

    it("should correctly compute modular power and modular inverse", function () {
        const base = 2n;
        const exp = 10n;
        const mod = 1000n;
        // 2^10 = 1024. 1024 mod 1000 = 24
        expect(modPow(base, exp, mod)).to.equal(24n);

        // modular inverse of 3 modulo 11 is 4 (since 3 * 4 = 12 = 1 mod 11)
        expect(modInverse(3n, 11n)).to.equal(4n);
    });
});
