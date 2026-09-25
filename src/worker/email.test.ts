import { describe, expect, it } from "vitest";
import { magicLinkEmail } from "@/server/email/templates";
import { EmailSendError, FALLBACK_SENDER, senderAddress, sendWithResend } from "./email";

const job = { to: "a@b.co", subject: "Hi", text: "t", html: "<p>t</p>" };

describe("senderAddress", () => {
  it("uses EMAIL_FROM, else the Resend test sender with the product name", () => {
    expect(senderAddress("Brand <login@mail.brand.tld>", "Brand")).toBe("Brand <login@mail.brand.tld>");
    expect(senderAddress(undefined, "Brand")).toBe(`Brand <${FALLBACK_SENDER}>`);
  });
});

describe("sendWithResend", () => {
  it("posts to Resend with the API key", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const id = await sendWithResend(job, { apiKey: "re_test", from: "x@y.z" }, async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    });
    expect(id).toBe("email_1");
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect(new Headers(seen!.init!.headers).get("authorization")).toBe("Bearer re_test");
    expect(JSON.parse(String(seen!.init!.body))).toMatchObject({ to: ["a@b.co"], from: "x@y.z" });
  });

  it("raises the HTTP status on failure", async () => {
    const failing = async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 });
    await expect(sendWithResend(job, { apiKey: "k", from: "f" }, failing)).rejects.toMatchObject({ status: 403 });
    await expect(sendWithResend(job, { apiKey: "k", from: "f" }, failing)).rejects.toBeInstanceOf(EmailSendError);
  });
});

describe("magicLinkEmail", () => {
  it("contains the link and escapes it in HTML", () => {
    const email = magicLinkEmail({ to: "a@b.co", url: "https://app.x/auth/verify?token=a&b=<c>", productName: "Brand", welcome: true });
    expect(email.subject).toBe("Welcome to Brand");
    expect(email.text).toContain("https://app.x/auth/verify?token=a&b=<c>");
    expect(email.html).not.toContain("<c>");
    expect(email.html).toContain("&#60;c&#62;");
  });
});
