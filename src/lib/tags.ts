// Tag scheme for CRMs with tags (SPEC section 11, DECISIONS D-03):
// c2c, c2c_kw_<keyword>, c2c_vid_<videoId>, c2c_buyer.
export const TAG_ROOT = "c2c";
export const TAG_BUYER = "c2c_buyer";

// Latin diacritics are dropped so tags stay easy to filter in any tool; other
// scripts keep their letters and marks (Thai, Devanagari, Cyrillic...).
export function tagSlug(keyword: string): string {
  return keyword
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "");
}

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

// Note: some CRMs (GHL) lowercase tags, so the video id inside a tag is a
// label for people and filters, never the key for matching (tid is).
export function c2cTags(input: { keyword?: string | null; videoId?: string | null; buyer?: boolean }): string[] {
  const tags = [TAG_ROOT];
  const slug = input.keyword ? tagSlug(input.keyword) : "";
  if (slug) tags.push(`${TAG_ROOT}_kw_${slug}`);
  if (input.videoId && VIDEO_ID.test(input.videoId)) tags.push(`${TAG_ROOT}_vid_${input.videoId}`);
  if (input.buyer) tags.push(TAG_BUYER);
  return tags;
}
