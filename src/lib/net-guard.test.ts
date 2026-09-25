import { describe, expect, it } from "vitest";
import { checkWebhookUrl, isPrivateAddress } from "./net-guard";

describe("private addresses", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "ff02::1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.63.255.255", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("webhook url check", () => {
  it("accepts a public https endpoint", () => {
    expect(checkWebhookUrl("https://hooks.example.com/c2c?x=1")).toMatchObject({ ok: true });
  });

  it.each([
    "http://hooks.example.com/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://169.254.169.254/latest/meta-data",
    "https://intranet/x",
    "https://db.railway.internal/x",
    "https://printer.local/x",
    "https://user:pass@hooks.example.com/x",
    "ftp://hooks.example.com",
    "hooks.example.com",
    "",
  ])("refuses %s", (url) => {
    expect(checkWebhookUrl(url)).toMatchObject({ ok: false });
  });

  it("allows http only when asked to (tests)", () => {
    expect(checkWebhookUrl("http://hooks.example.com/x", { allowHttp: true })).toMatchObject({ ok: true });
  });
});
