import { describe, expect, it } from "vitest";
import { actionResponse, noteText, parseActionRequest, type SourceInfo, verifyActionKey } from "./action";

const source: SourceInfo = {
  videoId: "dQw4w9WgXcQ",
  videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  keyword: "guide",
  intent: "hot",
  stage: "subscriber",
  optedInAt: new Date("2026-09-26T10:12:30Z"),
};

describe("workflow action request", () => {
  it("reads the location and contact from extras", () => {
    expect(parseActionRequest({ data: {}, extras: { locationId: "L1", contactId: "C1", workflowId: "W1" }, meta: { key: "find_source" } })).toEqual({
      locationId: "L1",
      contactId: "C1",
      addNote: true,
    });
  });

  it("turns the note off only on an explicit no", () => {
    const extras = { locationId: "L1", contactId: "C1" };
    for (const value of ["no", "No", "false", "0", "off"]) expect(parseActionRequest({ data: { add_note: value }, extras })?.addNote).toBe(false);
    for (const value of ["yes", "", "maybe", undefined]) expect(parseActionRequest({ data: { add_note: value }, extras })?.addNote).toBe(true);
    expect(parseActionRequest({ extras })?.addNote).toBe(true);
  });

  it("rejects a body without a location or contact", () => {
    expect(parseActionRequest(null)).toBeNull();
    expect(parseActionRequest("x")).toBeNull();
    expect(parseActionRequest({ extras: { locationId: "L1" } })).toBeNull();
    expect(parseActionRequest({ extras: { contactId: "C1" } })).toBeNull();
    expect(parseActionRequest({ extras: { locationId: 1, contactId: 2 } })).toBeNull();
  });
});

describe("shared secret", () => {
  it("accepts only the exact secret and refuses when none is configured", () => {
    expect(verifyActionKey("s3cret", "s3cret")).toBe(true);
    expect(verifyActionKey(" s3cret ", "s3cret")).toBe(true);
    expect(verifyActionKey("other", "s3cret")).toBe(false);
    expect(verifyActionKey(null, "s3cret")).toBe(false);
    expect(verifyActionKey("s3cret", undefined)).toBe(false);
    expect(verifyActionKey("", "")).toBe(false);
  });
});

describe("answer and note", () => {
  it("always answers with the same variables", () => {
    const found = actionResponse({ status: "ok", accountId: "a", integrationId: "i", source });
    expect(found).toEqual({
      found: "yes",
      video_id: "dQw4w9WgXcQ",
      video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      keyword: "guide",
      intent: "hot",
      stage: "subscriber",
      opted_in_at: "2026-09-26T10:12:30.000Z",
    });
    const missing = actionResponse({ status: "no_source", accountId: "a", integrationId: "i" });
    expect(Object.keys(missing)).toEqual(Object.keys(found));
    expect(missing.found).toBe("no");
    expect(missing.video_id).toBe("");
    expect(actionResponse({ status: "unknown_location" }).found).toBe("no");
  });

  it("writes the note from first-party facts only", () => {
    expect(noteText(source, "vidrev")).toBe(
      ["vidrev source", "Video: https://www.youtube.com/watch?v=dQw4w9WgXcQ", "Keyword: guide (hot)", "Opted in: 2026-09-26 10:12 UTC"].join("\n"),
    );
    expect(noteText({ ...source, intent: null }, "vidrev")).toContain("Keyword: guide\n");
  });
});
