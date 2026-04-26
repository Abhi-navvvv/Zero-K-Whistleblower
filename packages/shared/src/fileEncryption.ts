// File encryption/decryption using the same envelope encryption as text reports.
// AES-256-GCM for data encryption, RSA-OAEP for key wrapping.
//
// stripMetadata() runs before every encryption. Supported types are sanitised
// automatically; unsupported types return a warning that the UI can surface.

// ─── Metadata stripping ──────────────────────────────────────────────────────

export type SanitizationResult =
  | { safe: true; file: File; method: string }
  | { safe: false; file: File; warning: string };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"];
const PDF_TYPE = "application/pdf";

/**
 * Re-draws an image on a blank Canvas and exports it as PNG.
 * The Canvas API never copies EXIF, GPS, ICC profiles or thumbnails —
 * only raw pixel data is transferred. The output MIME is always image/png.
 */
async function stripImageMetadata(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context unavailable");
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) return reject(new Error("Canvas toBlob failed"));
          // Keep original filename, force PNG extension + MIME
          const safeName = file.name.replace(/\.[^.]+$/, "") + ".png";
          resolve(new File([blob], safeName, { type: "image/png" }));
        }, "image/png");
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for metadata stripping"));
    };
    img.src = url;
  });
}

/**
 * Loads a PDF with pdf-lib and saves it back with all metadata fields cleared.
 * Removes: Author, Creator, Producer, Keywords, Subject, Title, CreationDate,
 * ModificationDate — anything that could link the file back to the user.
 */
async function stripPdfMetadata(file: File): Promise<File> {
  const { PDFDocument } = await import("pdf-lib");
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, {
    // Ignore cross-reference errors in slightly malformed PDFs
    ignoreEncryption: false,
    updateMetadata: false,
  });

  // Wipe all standard document-info metadata fields
  pdfDoc.setAuthor("");
  pdfDoc.setCreator("");
  pdfDoc.setProducer("");
  pdfDoc.setKeywords([]);
  pdfDoc.setSubject("");
  pdfDoc.setTitle("");
  // Set generic fixed timestamps so timing can't be used for correlation
  const epoch = new Date(0);
  pdfDoc.setCreationDate(epoch);
  pdfDoc.setModificationDate(epoch);

  const cleanBytes = await pdfDoc.save({ addDefaultPage: false });
  return new File([cleanBytes], file.name, { type: "application/pdf" });
}

/**
 * Sanitises a file before encryption.
 *
 * - Images → redrawn on Canvas (strips EXIF / GPS / ICC / thumbnails)
 * - PDFs   → rebuilt via pdf-lib (clears all document metadata fields)
 * - Others → returned with safe: false and a warning for the UI to display
 *
 * The caller should always check `result.safe` and surface the warning to
 * the user before allowing them to proceed with unsupported file types.
 */
export async function stripMetadata(file: File): Promise<SanitizationResult> {
  try {
    if (IMAGE_TYPES.includes(file.type)) {
      const cleaned = await stripImageMetadata(file);
      return { safe: true, file: cleaned, method: "Canvas re-encode (EXIF/GPS removed)" };
    }

    if (file.type === PDF_TYPE) {
      const cleaned = await stripPdfMetadata(file);
      return { safe: true, file: cleaned, method: "pdf-lib rebuild (all metadata cleared)" };
    }

    // Unsupported — pass the original file through but flag the warning
    return {
      safe: false,
      file,
      warning:
        `"${file.name}" is a ${file.type || "unknown"} file. ` +
        "This file type cannot be automatically sanitised — it may contain hidden metadata " +
        "(author name, device ID, edit history) that could reveal your identity. " +
        "Consider converting it to PNG or PDF before attaching.",
    };
  } catch (err) {
    // If stripping fails, treat it like an unsupported type rather than silently encrypting
    return {
      safe: false,
      file,
      warning:
        `Metadata stripping failed for "${file.name}": ${err instanceof Error ? err.message : String(err)}. ` +
        "The file has not been sanitised. Proceed with caution.",
    };
  }
}

export interface EncryptedFileBlob {
  v: 2;
  type: "file";
  alg: "AES-256-GCM+RSA-OAEP-256";
  orgId: number;
  keyVersion: number;
  filename: string;
  mimeType: string;
  originalSize: number;
  nonce: string;      // base64, 12-byte AES-GCM nonce
  ciphertext: string; // base64, AES-GCM ciphertext + tag
  wrappedKey: string; // base64, RSA-OAEP wrapped 32-byte AES key
}

export interface FileAttachmentMeta {
  cid: string;
  filename: string;
  mimeType: string;
  originalSize: number;
}

export interface ReportManifest {
  v: 1;
  type: "manifest";
  textCid: string;
  files: FileAttachmentMeta[];
  createdAt: string;
  /** Role/league this report is directed to (e.g. "HR", "Ethics Board") */
  recipient?: { id: string; name: string };
  /** Communication key (hex) for anonymous two-way messaging. Derived from whistleblower's secret. */
  commKey?: string;
}

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let str = "";
  for (let i = 0; i < bytes.length; i += 4096) {
    str += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return btoa(str);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
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

/**
 * Encrypt a File object using AES-256-GCM + RSA-OAEP key wrapping.
 * The file bytes are read entirely into memory, encrypted, and returned
 * as a JSON-serialisable blob.
 */
export async function encryptFile(
  file: File,
  publicKeyB64: string,
  orgId: number,
  keyVersion = 1
): Promise<EncryptedFileBlob> {
  const fileBytes = new Uint8Array(await file.arrayBuffer());

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
    fileBytes
  );

  const rsaPublicKey = await importRsaPublicKey(publicKeyB64);
  const wrappedKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaPublicKey,
    dataKeyBytes
  );

  return {
    v: 2,
    type: "file",
    alg: "AES-256-GCM+RSA-OAEP-256",
    orgId,
    keyVersion,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    originalSize: file.size,
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
    wrappedKey: toBase64(wrappedKey),
  };
}

/**
 * Decrypt an encrypted file blob using the org's RSA private key.
 * Returns the raw file bytes alongside the original filename and MIME type.
 */
export async function decryptFile(
  blob: EncryptedFileBlob,
  privateKeyB64: string
): Promise<{ data: Uint8Array; filename: string; mimeType: string }> {
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

  return {
    data: new Uint8Array(plaintext),
    filename: blob.filename,
    mimeType: blob.mimeType,
  };
}

/**
 * Check if a decrypted payload is a report manifest (v2 with file attachments)
 * vs. a plain text report (v1).
 */
export function isReportManifest(obj: unknown): obj is ReportManifest {
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as ReportManifest).type === "manifest" &&
    typeof (obj as ReportManifest).textCid === "string" &&
    Array.isArray((obj as ReportManifest).files)
  );
}
