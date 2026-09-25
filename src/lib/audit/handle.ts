// What a visitor types into "Audit my channel": an @handle, a channel URL or a
// channel id. Only forms the YouTube Data API resolves for 1 unit are accepted
// (channels.list by handle, id or legacy username). Custom "/c/name" URLs need
// search.list (100 units) and are refused with a hint (DECISIONS P9-02).

export type ChannelRef =
  | { kind: "handle"; handle: string; key: string }
  | { kind: "id"; id: string; key: string }
  | { kind: "username"; username: string; key: string };

export type ChannelRefResult = { ok: true; ref: ChannelRef } | { ok: false; error: string };

const HANDLE = /^[A-Za-z0-9._-]{3,30}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

const HINT = "Paste your @handle (for example @yourname) or the channel URL that contains /@handle or /channel/UC...";

function fromHandle(raw: string): ChannelRefResult {
  const name = raw.replace(/^@/, "");
  if (!HANDLE.test(name)) return { ok: false, error: HINT };
  return { ok: true, ref: { kind: "handle", handle: `@${name}`, key: `handle:${name.toLowerCase()}` } };
}

function fromId(id: string): ChannelRefResult {
  if (!CHANNEL_ID.test(id)) return { ok: false, error: HINT };
  return { ok: true, ref: { kind: "id", id, key: `id:${id}` } };
}

export function parseChannelInput(input: string): ChannelRefResult {
  const value = input.trim();
  if (value.length === 0 || value.length > 300) return { ok: false, error: HINT };

  if (/^https?:\/\//i.test(value) || /^(www\.|m\.)?youtube\.com\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return { ok: false, error: HINT };
    }
    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return { ok: false, error: HINT };
    const parts = url.pathname.split("/").filter(Boolean);
    const first = parts[0] ?? "";
    if (first.startsWith("@")) return fromHandle(decodeURIComponent(first));
    if (first === "channel" && parts[1]) return fromId(parts[1]);
    if (first === "user" && parts[1] && HANDLE.test(parts[1])) {
      return { ok: true, ref: { kind: "username", username: parts[1], key: `username:${parts[1].toLowerCase()}` } };
    }
    if (first === "c") {
      return { ok: false, error: "Custom /c/ URLs cannot be looked up. Open your channel and paste the URL that contains /@handle." };
    }
    return { ok: false, error: HINT };
  }

  if (CHANNEL_ID.test(value)) return fromId(value);
  return fromHandle(value);
}
