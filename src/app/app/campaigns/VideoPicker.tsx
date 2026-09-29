"use client";

import { useMemo, useState } from "react";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";

export interface VideoOption {
  id: string;
  title: string | null;
  publishedAt: string | null;
  thumbnail: string | null;
  views: number | null;
  comments: number | null;
}

type Sort = "recent" | "views" | "comments";

const SORTS: { key: Sort; label: string }[] = [
  { key: "recent", label: "Newest" },
  { key: "views", label: "Most viewed" },
  { key: "comments", label: "Most comments" },
];

function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

// Step 1 "Which videos?": all videos by default (new uploads included);
// untick to pick. One quiet row per video, sortable; pasting links is advanced.
export function VideoPicker({ videos, hasStats }: { videos: VideoOption[]; hasStats: boolean }) {
  const [all, setAll] = useState(true);
  const [sort, setSort] = useState<Sort>("recent");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    const list = [...videos];
    if (sort === "views") list.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
    else if (sort === "comments") list.sort((a, b) => (b.comments ?? -1) - (a.comments ?? -1));
    else list.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    return list;
  }, [videos, sort]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid gap-3">
      <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-surface p-3">
        <input type="checkbox" name="allVideos" value="1" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-4 flex-none accent-[var(--primary-600)]" />
        <span className="grid gap-0.5">
          <span className="text-[15px] font-semibold">All my videos, including new uploads</span>
          <span className="text-[13px] text-muted-foreground">{all ? "Untick to pick only some videos." : "Pick the videos below."}</span>
        </span>
      </label>

      {!all ? (
        <div className="grid gap-2">
          {hasStats ? (
            <div role="group" aria-label="Sort videos" className="flex flex-wrap gap-1.5">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSort(s.key)}
                  aria-pressed={sort === s.key}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[13px] font-semibold",
                    sort === s.key ? "border-primary bg-primary-50 text-primary-700" : "border-border bg-surface text-label hover:border-border-strong",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
          {sorted.length ? (
            <div className="grid max-h-80 gap-0.5 overflow-y-auto rounded-md border border-border bg-surface p-1.5">
              {sorted.map((video) => (
                <label key={video.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-background", picked.has(video.id) && "bg-background")}>
                  <input type="checkbox" name="videoIds" value={video.id} checked={picked.has(video.id)} onChange={() => toggle(video.id)} className="size-4 flex-none accent-[var(--primary-600)]" />
                  {video.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={video.thumbnail} alt="" width={64} height={36} loading="lazy" className="h-9 w-16 flex-none rounded object-cover" />
                  ) : null}
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-[14px]">{video.title ?? video.id}</span>
                    <span className="text-[12px] text-muted-foreground">
                      {[
                        video.publishedAt?.slice(0, 10),
                        video.views !== null ? `${compact(video.views)} views` : null,
                        video.comments !== null ? `${compact(video.comments)} comments` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="m-0 text-[14px] text-muted-foreground">No videos to show yet. Paste a video link under Advanced.</p>
          )}
          <p className="m-0 text-[13px] text-muted-foreground">{picked.size} selected. Only comments on the chosen videos get a reply draft.</p>
        </div>
      ) : null}

      <details className="rounded-md bg-background p-3 text-[15px]">
        <summary className="cursor-pointer font-semibold">Advanced: paste video links</summary>
        <p className="mb-2 mt-2 text-[13px] text-muted-foreground">For a video not in the list (for example an older one). Untick &quot;All my videos&quot; first.</p>
        <Textarea name="videos" rows={2} placeholder="https://youtu.be/..." aria-label="Video links" disabled={all} />
      </details>
    </div>
  );
}
