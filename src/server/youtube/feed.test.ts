import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseFeed, verifyHubSignature, websubSecret } from "./feed";

const push = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <link rel="hub" href="https://pubsubhubbub.appspot.com"/>
  <title>YouTube video feed</title>
  <entry>
    <id>yt:video:VIDEO123</id>
    <yt:videoId>VIDEO123</yt:videoId>
    <yt:channelId>UCabc</yt:channelId>
    <title>How to &amp; why</title>
    <published>2026-09-25T10:00:00+00:00</published>
    <updated>2026-09-25T10:05:00+00:00</updated>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("reads video id, channel id, title and publish time", () => {
    expect(parseFeed(push)).toEqual([
      { videoId: "VIDEO123", channelId: "UCabc", title: "How to & why", published: new Date("2026-09-25T10:00:00Z") },
    ]);
  });

  it("skips deleted entries and garbage", () => {
    const deleted = `<feed xmlns:at="http://purl.org/atompub/tombstones/1.0"><at:deleted-entry ref="yt:video:X" when="2026-09-25T10:00:00+00:00"/></feed>`;
    expect(parseFeed(deleted)).toEqual([]);
    expect(parseFeed("not xml")).toEqual([]);
  });
});

describe("hub signature", () => {
  it("verifies HMAC-SHA1 of the raw body with the per-channel secret", () => {
    const secret = websubSecret("master", "channel-1");
    expect(secret).not.toBe(websubSecret("master", "channel-2"));
    const signature = createHmac("sha1", secret).update(push).digest("hex");
    expect(verifyHubSignature(push, `sha1=${signature}`, secret)).toBe(true);
    expect(verifyHubSignature(`${push} `, `sha1=${signature}`, secret)).toBe(false);
    expect(verifyHubSignature(push, null, secret)).toBe(false);
    expect(verifyHubSignature(push, `md5=${signature}`, secret)).toBe(false);
  });
});
