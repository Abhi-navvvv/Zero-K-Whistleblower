// Browser-side secret generation for admin key file creation.
// The secret is stored in plaintext — it is a random number with no connection
// to any real-world identity, so encrypting it with a password only adds UX
// friction without meaningful security benefit.

export interface MemberKeyFile {
  memberId: string;
  commitment: string;
  secret: string;
}

export interface MemberManifest {
  commitments: string[];
  root: string;
  memberCount: number;
  treeDepth: number;
  /** Admin-defined recipient roles/leagues (e.g. "HR", "Ethics Board") */
  leagues?: { id: string; name: string }[];
}

function bytesToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const pairs = hex.match(/.{2}/g);
  if (!pairs) throw new Error("Invalid hex string");
  const buf = new ArrayBuffer(pairs.length);
  const view = new Uint8Array(buf);
  pairs.forEach((b, i) => {
    view[i] = parseInt(b, 16);
  });
  return view;
}

// 31 bytes keeps the value inside the BN128 scalar field, same as the Node.js script.
export function generateSecret(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  return BigInt("0x" + bytesToHex(bytes));
}

//  Download helper 

/* Triggers a browser download of a JSON object. */
export function downloadJSON(data: object, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Reads a plaintext key file and returns the secret bigint.
 * Also handles legacy encrypted key files gracefully by returning null,
 * so the submit page can show an appropriate message.
 */
export function readKeyFileSecret(keyFile: MemberKeyFile): bigint | null {
  if (typeof keyFile.secret === "string" && keyFile.secret.trim()) {
    try {
      return BigInt(keyFile.secret.trim());
    } catch {
      return null;
    }
  }
  return null;
}
