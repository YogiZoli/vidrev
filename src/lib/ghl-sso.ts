import { createDecipheriv, createHash } from "node:crypto";

// GoHighLevel embeds the app (custom menu link) and, asked with
// postMessage("REQUEST_USER_DATA"), hands the iframe the logged-in user as a
// CryptoJS AES payload encrypted with the app's SSO key (Marketplace app,
// Advanced settings, Auth, Shared secret). CryptoJS default format: base64 of
// "Salted__" + 8 byte salt + AES-256-CBC ciphertext; key and iv from
// OpenSSL EVP_BytesToKey with MD5. Ported from C2C app/auth/ghl_sso.py.

export interface GhlSsoUser {
  userId: string | null;
  companyId: string | null;
  // The sub-account open in GoHighLevel; absent on agency-level pages.
  activeLocation: string | null;
  role: string | null;
  type: string | null;
  email: string | null;
  userName: string | null;
}

function evpBytesToKey(password: Buffer, salt: Buffer): { key: Buffer; iv: Buffer } {
  let data = Buffer.alloc(0);
  let prev = Buffer.alloc(0);
  while (data.length < 48) {
    prev = createHash("md5").update(Buffer.concat([prev, password, salt])).digest();
    data = Buffer.concat([data, prev]);
  }
  return { key: data.subarray(0, 32), iv: data.subarray(32, 48) };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// Throws on any malformed or wrong-key input, never saying which.
export function decryptGhlSso(payload: string, secret: string): GhlSsoUser {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < 32 || raw.subarray(0, 8).toString("latin1") !== "Salted__") throw new Error("invalid sso payload");
  const salt = raw.subarray(8, 16);
  const ciphertext = raw.subarray(16);
  if (ciphertext.length % 16 !== 0) throw new Error("invalid sso payload");
  const { key, iv } = evpBytesToKey(Buffer.from(secret, "utf8"), salt);
  let plain: string;
  try {
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("invalid sso payload");
  }
  let data: unknown;
  try {
    data = JSON.parse(plain);
  } catch {
    throw new Error("invalid sso payload");
  }
  if (!data || typeof data !== "object") throw new Error("invalid sso payload");
  const d = data as Record<string, unknown>;
  return {
    userId: str(d.userId),
    companyId: str(d.companyId),
    activeLocation: str(d.activeLocation) ?? str(d.locationId),
    role: str(d.role),
    type: str(d.type),
    email: str(d.email),
    userName: str(d.userName),
  };
}
