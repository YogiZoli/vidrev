"use client";

import { useState } from "react";
import { styles } from "../../ui";

export interface CardData {
  id: string;
  status: string;
  statusReason: string | null;
  keyword: string;
  intent: string;
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
  if (!card.commentUrl) return null;
  return (
    <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        style={styles.secondary}
        onClick={async () => {
          await navigator.clipboard.writeText(card.body.replace("{link}", card.link)).catch(() => {});
          setCopied(true);
          window.open(card.commentUrl!, "_blank", "noopener");
        }}
      >
        Copy reply and open comment
      </button>
      {copied ? (
        <button
          type="button"
          style={styles.secondary}
          onClick={async () => {
            if (!(await post("manual", card.id, { body: card.body }))) onDone();
          }}
        >
          I posted it
        </button>
      ) : null}
    </span>
  );
}

// One draft at a time, approved individually (no bulk approval, Q-12).
// Optimistic: the card disappears at once and comes back on an error.
export function PendingCards({ cards }: { cards: CardData[] }) {
  const [items, setItems] = useState(cards);
  const [bodies, setBodies] = useState<Record<string, string>>(() => Object.fromEntries(cards.map((c) => [c.id, c.body])));
  const [error, setError] = useState<string | null>(null);

  const act = async (card: CardData, action: string, extra: Record<string, string> = {}) => {
    setError(null);
    setItems((list) => list.filter((c) => c.id !== card.id));
    const problem = await post(action, card.id, extra);
    if (problem) {
      setError(problem);
      setItems((list) => [card, ...list]);
    }
  };

  if (items.length === 0) return <p style={styles.muted}>No drafts waiting. New keyword comments appear here.</p>;
  const card = items[0]!;
  return (
    <div style={styles.card}>
      {error ? <p style={{ color: "#b00" }}>{error}</p> : null}
      <p style={{ ...styles.muted, margin: 0 }}>
        {items.length} waiting · {card.videoTitle ?? "Video"} · keyword <strong>{card.keyword}</strong> ({card.intent.toUpperCase()})
      </p>
      <blockquote style={{ margin: "12px 0", padding: "8px 12px", borderLeft: "3px solid #ccc" }}>{card.commentText ?? "(comment no longer stored)"}</blockquote>
      {card.repliedBefore ? <p style={styles.muted}>You already replied to this person on this video.</p> : null}
      {card.otherMatches.length ? (
        <p style={styles.muted}>
          Also matched:{" "}
          {card.otherMatches.map((m) => (
            <button key={m.campaignId} type="button" style={{ ...styles.secondary, marginRight: 6 }} onClick={() => act(card, "switch", { campaignId: m.campaignId }).then(() => location.reload())}>
              use {m.keyword}
            </button>
          ))}
        </p>
      ) : null}
      <textarea
        value={bodies[card.id] ?? card.body}
        onChange={(event) => setBodies((b) => ({ ...b, [card.id]: event.target.value }))}
        rows={3}
        style={styles.input}
      />
      <p style={{ ...styles.muted, fontSize: 13 }}>{"{link}"} becomes {card.link}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={styles.button} onClick={() => act(card, "approve", { body: bodies[card.id] ?? card.body })}>
          Approve and send
        </button>
        <button type="button" style={styles.secondary} onClick={() => act(card, "dismiss")}>
          Skip
        </button>
        <ManualFallback card={{ ...card, body: bodies[card.id] ?? card.body }} onDone={() => setItems((list) => list.filter((c) => c.id !== card.id))} />
      </div>
    </div>
  );
}

export function WaitingCards({ cards }: { cards: CardData[] }) {
  const [items, setItems] = useState(cards);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((card) => (
        <div key={card.id} style={{ ...styles.card, padding: 12 }}>
          <p style={{ margin: "0 0 6px" }}>
            <strong>{card.keyword}</strong> · {card.eta ?? "sending"}
          </p>
          <p style={{ ...styles.muted, margin: "0 0 8px" }}>{card.body.replace("{link}", card.link)}</p>
          {card.status === "queued" ? <ManualFallback card={card} onDone={() => setItems((list) => list.filter((c) => c.id !== card.id))} /> : null}
        </div>
      ))}
    </>
  );
}
