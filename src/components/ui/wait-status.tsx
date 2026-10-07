import { Notice } from "./notice";

// How long ago, in words a creator reads at a glance.
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// A process that runs on our side while the creator waits: how long it has
// run, whether that is normal, when it gives up on its own, and whether the
// page (or the laptop) can be closed meanwhile.
export function WaitStatus({
  startedAt,
  now = new Date(),
  usualSeconds,
  giveUpMinutes,
  leave,
}: {
  startedAt: Date;
  now?: Date;
  usualSeconds: number;
  // Absent: the work is retried until it is done.
  giveUpMinutes?: number;
  leave: string;
}) {
  const ms = now.getTime() - startedAt.getTime();
  const slow = ms > usualSeconds * 1000;
  return (
    <Notice tone="info">
      Working on it for {elapsedText(ms)}.{" "}
      {slow
        ? giveUpMinutes
          ? `This is taking longer than usual, but it is still running. If it cannot finish, it stops by itself within ${giveUpMinutes} minutes and this page tells you why.`
          : "This is taking longer than usual. It is retried automatically until it is done, and we are alerted if it keeps failing."
        : `This usually takes under ${elapsedText(usualSeconds * 1000)}. This page updates by itself.`}{" "}
      {leave}
    </Notice>
  );
}
