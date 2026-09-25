import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Secrets at rest (OAuth tokens, AI keys, integration configs) are stored as
// "v1:<base64(iv | tag | ciphertext)>". The version prefix lets ENCRYPTION_KEY
// be rotated later without guessing which key encrypted a value.
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return key;
}

export function encryptSecret(plaintext: string, keyBase64: string): string {
  const key = loadKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decryptSecret(value: string, keyBase64: string): string {
  const [version, payload] = value.split(":", 2);
  if (version !== VERSION || !payload) throw new Error("Unsupported ciphertext version");
  const raw = Buffer.from(payload, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("Ciphertext too short");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(keyBase64), raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}

// Random, URL-safe token for magic links, sessions and OAuth state.
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

// Tokens are stored only as hashes, so a database leak does not leak logins.
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256Hex(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// Constant-time string comparison; unequal lengths return false without
// leaking where the strings differ.
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
