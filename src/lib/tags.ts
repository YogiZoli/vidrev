// Tag scheme for CRMs with tags (SPEC section 11, DECISIONS A-11): one
// dimension per tag, every word written out, no abbreviations.
//   vidrev                                  everything that came from vidrev
//   vidrev-source-youtube                   came through a YouTube reply link
//   vidrev-keyword-<keyword>                each keyword whose link they clicked
//   vidrev-temperature-<cold|warm|hot>-lead the hottest of those keywords
//   vidrev-video-<videoId>                  each video whose reply link they clicked
//   vidrev-buyer                            bought
// Only first-party click data feeds these tags, never YouTube API data about
// the commenter (A-12): the history comes from our own tracked-link clicks.
export const TAG_ROOT = "vidrev";
export const TAG_SOURCE = "vidrev-source-youtube";
export const TAG_BUYER = "vidrev-buyer";
// Beast Mode contact made at comment time, no email yet (A-25). Also one of
// the ownership proofs checked before the 29 day delete (A-27).
export const TAG_PROSPECT = "vidrev-prospect";

export const TEMPERATURES = ["cold", "warm", "hot"] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export function temperatureTag(temperature: Temperature): string {
  return `${TAG_ROOT}-temperature-${temperature}-lead`;
}

// Latin diacritics are dropped so tags stay easy to filter in any tool; other
// scripts keep their letters and marks (Thai, Devanagari, Cyrillic...).
export function tagSlug(keyword: string): string {
  return keyword
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

export interface TagTouch {
  keyword?: string | null;
  intent?: string | null;
  videoId?: string | null;
}

// The hottest temperature among the touches: a person who clicked a GUIDE
// (cold) and later a CALL (hot) link is a hot lead.
export function hottest(touches: readonly TagTouch[]): Temperature | null {
  let best = -1;
  for (const { intent } of touches) best = Math.max(best, TEMPERATURES.indexOf(intent as Temperature));
  return best >= 0 ? TEMPERATURES[best]! : null;
}

// Note: some CRMs (GHL) lowercase tags, so the video id inside a tag is a
// label for people and filters, never the key for matching (tid is).
export function vidrevTags(input: TagTouch & { buyer?: boolean; history?: readonly TagTouch[] }): string[] {
  const touches = [input, ...(input.history ?? [])];
  const tags = [TAG_ROOT];
  const add = (tag: string) => {
    if (!tags.includes(tag)) tags.push(tag);
  };
  const slugs = touches.map((t) => (t.keyword ? tagSlug(t.keyword) : "")).filter(Boolean);
  if (slugs.length > 0) add(TAG_SOURCE);
  for (const slug of slugs) add(`${TAG_ROOT}-keyword-${slug}`);
  const temperature = hottest(touches);
  if (temperature) add(temperatureTag(temperature));
  for (const touch of touches) {
    if (touch.videoId && VIDEO_ID.test(touch.videoId)) add(`${TAG_ROOT}-video-${touch.videoId}`);
  }
  if (input.buyer) add(TAG_BUYER);
  return tags;
}
