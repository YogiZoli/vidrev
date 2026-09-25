import { describe, expect, it } from "vitest";
import { renderReply, templateProblems } from "./templates";

describe("templateProblems", () => {
  it("accepts a reply with exactly one link placeholder", () => {
    expect(templateProblems("Here you go: {link} Enjoy!")).toEqual([]);
  });

  it("requires the link placeholder exactly once", () => {
    expect(templateProblems("Here you go")).toEqual(["missing_link"]);
    expect(templateProblems("{link} and {link}")).toEqual(["several_links"]);
    expect(templateProblems("   ")).toEqual(["empty"]);
  });

  it("rejects engagement bait in several languages", () => {
    for (const body of [
      "Subscribe and get it: {link}",
      "Smash that like button {link}",
      "Iratkozz fel, és itt a link: {link}. Feliratkozás kötelező",
      "Suscríbete: {link}",
      "Turn on the bell {link}",
    ]) {
      expect(templateProblems(body)).toContain("engagement_bait");
    }
  });

  it("rejects replies over the length limit", () => {
    expect(templateProblems(`${"a".repeat(1000)} {link}`)).toContain("too_long");
  });
});

describe("renderReply", () => {
  it("fills in the link", () => {
    expect(renderReply("Here: {link}", "https://go.example.com/x")).toBe("Here: https://go.example.com/x");
  });
});
