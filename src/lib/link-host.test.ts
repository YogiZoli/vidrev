import { afterEach, describe, expect, it } from "vitest";
import { fallbackHost } from "./link-host";

describe("fallbackHost", () => {
  const saved = process.env.LINK_FALLBACK_BASE_URL;
  afterEach(() => {
    process.env.LINK_FALLBACK_BASE_URL = saved;
  });

  it("reads a value pasted with a BOM or spaces", () => {
    process.env.LINK_FALLBACK_BASE_URL = "﻿https://go.example.com ";
    expect(fallbackHost()).toBe("go.example.com");
  });
});
