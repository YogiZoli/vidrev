import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { elapsedText, WaitStatus } from "./wait-status";

const start = new Date("2026-10-07T10:00:00Z");
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);

describe("WaitStatus", () => {
  it("says how long it has run in words", () => {
    expect(elapsedText(1000)).toBe("1 second");
    expect(elapsedText(42_000)).toBe("42 seconds");
    expect(elapsedText(125_000)).toBe("2 minutes");
  });

  it("is calm while within the usual time and says the page updates itself", () => {
    const html = renderToStaticMarkup(createElement(WaitStatus, { startedAt: start, now: at(10), usualSeconds: 30, giveUpMinutes: 10, leave: "You can close this page." }));
    expect(html).toContain("Working on it for 10 seconds.");
    expect(html).toContain("usually takes under 30 seconds");
    expect(html).toContain("You can close this page.");
  });

  it("says when it is slow and when it gives up on its own", () => {
    const html = renderToStaticMarkup(createElement(WaitStatus, { startedAt: start, now: at(90), usualSeconds: 30, giveUpMinutes: 10, leave: "" }));
    expect(html).toContain("taking longer than usual");
    expect(html).toContain("within 10 minutes");
  });

  it("says it keeps retrying when there is no give-up time", () => {
    const html = renderToStaticMarkup(createElement(WaitStatus, { startedAt: start, now: at(900), usualSeconds: 30, leave: "" }));
    expect(html).toContain("retried automatically until it is done");
  });
});
