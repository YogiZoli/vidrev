import { describe, expect, it } from "vitest";
import { checkPageUrl } from "./fetch-page";

describe("checkPageUrl", () => {
  it("accepts public http and https pages on the standard ports", () => {
    expect(checkPageUrl("https://coach.com/guide").ok).toBe(true);
    expect(checkPageUrl("http://coach.com/guide").ok).toBe(true);
    expect(checkPageUrl("https://coach.com:443/guide").ok).toBe(true);
  });

  it("refuses private, metadata and internal targets", () => {
    for (const url of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      "http://[::1]/",
      "http://2130706433/",
      "http://db.railway.internal/",
      "http://intranet/",
    ]) {
      expect(checkPageUrl(url).ok, url).toBe(false);
    }
  });

  it("refuses other ports, credentials and other schemes", () => {
    expect(checkPageUrl("https://coach.com:8443/").ok).toBe(false);
    expect(checkPageUrl("https://user:pass@coach.com/").ok).toBe(false);
    expect(checkPageUrl("ftp://coach.com/file").ok).toBe(false);
    expect(checkPageUrl("file:///etc/passwd").ok).toBe(false);
  });
});
