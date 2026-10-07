import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptGhlSso } from "./ghl-sso";

// What CryptoJS.AES.encrypt(JSON.stringify(data), secret).toString() produces.
function cryptoJsEncrypt(text: string, secret: string): string {
  const salt = randomBytes(8);
  let data = Buffer.alloc(0);
  let prev = Buffer.alloc(0);
  while (data.length < 48) {
    prev = createHash("md5").update(Buffer.concat([prev, Buffer.from(secret), salt])).digest();
    data = Buffer.concat([data, prev]);
  }
  const cipher = createCipheriv("aes-256-cbc", data.subarray(0, 32), data.subarray(32, 48));
  return Buffer.concat([Buffer.from("Salted__"), salt, cipher.update(text, "utf8"), cipher.final()]).toString("base64");
}

describe("decryptGhlSso", () => {
  const user = { userId: "u1", companyId: "c1", role: "admin", type: "location", activeLocation: "loc1", userName: "Ann", email: "ann@example.com" };

  it("decrypts a CryptoJS payload", () => {
    expect(decryptGhlSso(cryptoJsEncrypt(JSON.stringify(user), "shh"), "shh")).toEqual(user);
  });

  it("accepts locationId when activeLocation is missing", () => {
    const { activeLocation: _, ...rest } = user;
    expect(decryptGhlSso(cryptoJsEncrypt(JSON.stringify({ ...rest, locationId: "loc2" }), "k"), "k").activeLocation).toBe("loc2");
  });

  it("refuses a wrong key, garbage and non-objects", () => {
    expect(() => decryptGhlSso(cryptoJsEncrypt(JSON.stringify(user), "right"), "wrong")).toThrow("invalid sso payload");
    expect(() => decryptGhlSso("bm90IGEgcGF5bG9hZA==", "k")).toThrow("invalid sso payload");
    expect(() => decryptGhlSso(cryptoJsEncrypt("42", "k"), "k")).toThrow("invalid sso payload");
  });
});
