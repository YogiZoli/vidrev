"use client";

import { useState } from "react";
import { useCopied } from "@/components/motion/CopyButton";
import { useToast } from "@/components/motion/Toast";
import { EmptyState } from "@/components/ui/empty";
import { cn } from "@/lib/cn";
import { Badge, Keyword, TemperatureChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Meta } from "@/components/ui/page";

export interface CardData {
  id: string;
  status: string;
  statusReason: string | null;
  keyword: string;
  intent: "hot" | "warm" | "cold";
  otherMatches: { campaignId: string; keyword: string; intent: string }[];
  body: string;
  link: string;
  commentText: string | null;
  videoTitle: string | null;
  commentUrl: string | null;
  repliedBefore: boolean;
  eta: string | null;
}

async function post(action: string, replyId: string, extra: Record<string, string> = {}): Promise<string | null> {
  const response = await fetch("/api/replies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, replyId, ...extra }),
  }).catch(() => null);
  if (!response) return "Network error. Try again.";
  if (response.ok) return null;
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  return json.error ?? "Something went wrong.";
}

// "Copy reply and open comment on YouTube" (0 quota units, D-25).
function ManualFallback({ card, onDone }: { card: CardData; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const flash = useCopied();
  if (!card.commentUrl) return null;
  return (
    <span className="inline-flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(card.body.replace("{link}", card.link)).catch(() => {});
          setCopied(true);
          flash.flip();
          window.open(card.commentUrl!, "_blank", "noopener");
        }}
      >
        {flash.copied ? "Copied" : "Copy reply and open comment"}
      </Button>
      {copied ? (
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            if (!(await post("manual", card.id, { body: card.body }))) onDone();
          }}
        >
          I posted it
        </Button>
      ) : null}
    </span>
  );
}

// One draft at a time, approved individually (no bulk approval, Q-12).
// Optimistic: the card disappears at once and comes back on an error.
export function PendingCards({ cards, usage }: { cards: CardData[]; usage?: { today: number; dailyCap: number | null } }) {
  const toast = useToast();
  const [items, setItems] = useState(cards);
  const [today, setToday] = useState(usage?.today ?? 0);
  const [bump, setBump] = useState(0);
  const [bodies, setBodies] = useState<Record<string, string>>(() => Object.fromEntries(cards.map((c) => [c.id, c.body])));
  const [error, setError] = useState<string | null>(null);

  const act = async (card: CardData, action: string, extra: Record<string, string> = {}) => {
    setError(null);
    setItems((list) => list.filter((c) => c.id !== card.id));
    if (action === "approve") {
      setToday((n) => n + 1);
      setBump((n) => n + 1);
    }
    const problem = await post(action, card.id, extra);
    if (problem) {
      setError(problem);
      setItems((list) => [card, ...list]);
      if (action === "approve") setToday((n) => Math.max(0, n - 1));
      return;
    }
    if (action === "approve") toast("Approved. Sending your reply.");
    if (action === "dismiss") toast("Skipped.");
  };

  if (items.length === 0) return <EmptyState title="No drafts waiting.">New keyword comments appear here.</EmptyState>;
  const card = items[0]!;
  return (
    <Card key={card.id} variant="focus" className="grid animate-card-in gap-3">
      {usage?.dailyCap ? (
        <div className="grid gap-1.5">
          <p className="m-0 text-[13px] text-muted-foreground">
            Replies today:{" "}
            <strong key={bump} className={cn("inline-block text-foreground", bump > 0 && "animate-num-pop")}>
              {today}
            </strong>{" "}
            of {usage.dailyCap}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full origin-left rounded-full bg-live transition-[width] duration-500" style={{ width: `${Math.min(100, (today / usage.dailyCap) * 100)}%` }} />
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 rounded-md border border-danger-border bg-danger-surface p-2.5 text-sm text-danger-text">
          {error}
        </p>
      ) : null}
      <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] text-muted-foreground">
        <Badge tone="primary">{items.length} waiting</Badge>
        <span>{card.videoTitle ?? "Video"}</span>
        <Keyword temperature={card.intent}>{card.keyword}</Keyword>
        <TemperatureChip temperature={card.intent} />
      </p>
      <blockquote className="m-0 rounded-md border-l-[3px] border-border-strong bg-background px-3 py-2 text-base">{card.commentText ?? "(comment no longer stored)"}</blockquote>
      {card.repliedBefore ? <Meta>You already replied to this person on this video.</Meta> : null}
      {card.otherMatches.length ? (
        <p className="m-0 flex flex-wrap items-center gap-1.5 text-[15px] text-muted-foreground">
          Also matched:
          {card.otherMatches.map((m) => (
            <Button key={m.campaignId} type="button" variant="outline" size="sm" onClick={() => act(card, "switch", { campaignId: m.campaignId }).then(() => location.reload())}>
              use {m.keyword}
            </Button>
          ))}
        </p>
      ) : null}
      <Textarea
        value={bodies[card.id] ?? card.body}
        onChange={(event) => setBodies((b) => ({ ...b, [card.id]: event.target.value }))}
        rows={3}
        aria-label="Reply text"
      />
      <Meta className="font-mono">
        {"{link}"} becomes {card.link}
      </Meta>
      <div className="flex flex-wrap gap-2">
        <Button type="button" pulse onClick={() => act(card, "approve", { body: bodies[card.id] ?? card.body })}>
          Approve and send
        </Button>
        <Button type="button" variant="outline" onClick={() => act(card, "dismiss")}>
          Skip
        </Button>
        <ManualFallback card={{ ...card, body: bodies[card.id] ?? card.body }} onDone={() => setItems((list) => list.filter((c) => c.id !== card.id))} />
      </div>
    </Card>
  );
}

export function WaitingCards({ cards }: { cards: CardData[] }) {
  const [items, setItems] = useState(cards);
  if (items.length === 0) return null;
  return (
    <div className="grid gap-3">
      {items.map((card) => (
        <Card key={card.id} className="grid gap-2 p-4">
          <p className="m-0 text-[15px]">
            <Keyword temperature={card.intent}>{card.keyword}</Keyword> <span className="text-muted-foreground">{card.eta ?? "sending"}</span>
          </p>
          <p className="m-0 text-[15px] text-label">{card.body.replace("{link}", card.link)}</p>
          {card.status === "queued" ? <ManualFallback card={card} onDone={() => setItems((list) => list.filter((c) => c.id !== card.id))} /> : null}
        </Card>
      ))}
    </div>
  );
}
