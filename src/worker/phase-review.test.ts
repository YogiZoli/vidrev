import { describe, expect, it } from "vitest";
import { offerText } from "./drafts";
import { isUniqueViolation } from "./stripe";

describe("offerText (AI prompt)", () => {
  it("uses the catalog text when the rule carries the keyword as its name", () => {
    expect(offerText({ name: "GUIDE", keyword: "GUIDE" })).toBe("a free guide");
    expect(offerText({ name: "trigger", keyword: "TRIGGER" })).toBe("a link to buy now");
  });

  it("keeps a real name, and falls back to the name for unknown keywords", () => {
    expect(offerText({ name: "My 7-step funnel guide", keyword: "GUIDE" })).toBe("My 7-step funnel guide");
    expect(offerText({ name: "PLAYBOOK", keyword: "PLAYBOOK" })).toBe("PLAYBOOK");
  });
});

describe("isUniqueViolation", () => {
  it("is true only for Postgres 23505, direct or wrapped", () => {
    expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
    expect(isUniqueViolation(new Error("wrapped", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation(new Error("connection terminated"))).toBe(false);
    expect(isUniqueViolation(new Error("wrapped", { cause: { code: "57P01" } }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
