import { describe, expect, it } from "vitest";
import { preferredKinds } from "@/app/app/campaigns/DestinationPicker";
import { BOOKING_URL, funnelDestinations, stepKind, SURVEY_URL } from "./destinations";

describe("GoHighLevel destinations", () => {
  it("sorts funnel steps by what the viewer does there", () => {
    expect(stepKind("optin_funnel_page")).toBe("optin");
    expect(stepKind("order_form")).toBe("order");
    expect(stepKind("upsell")).toBe("order");
    expect(stepKind("thank_you")).toBe("page");
    expect(stepKind(undefined)).toBe("page");
  });

  it("lists every step with a path, named by funnel and step", () => {
    const list = funnelDestinations([
      { _id: "f1", name: "vidrev Landing", type: "funnel", steps: [{ name: "vidrev Landing", url: "/vidrev-landing", type: "optin_funnel_page" }] },
      { _id: "f2", name: "Offer", type: "funnel", steps: [{ name: "Checkout", url: "checkout", type: "order_form" }, { name: "No url" }] },
    ]);
    expect(list).toEqual([
      { kind: "optin", name: "vidrev Landing", path: "/vidrev-landing" },
      { kind: "order", name: "Offer: Checkout", path: "/checkout" },
    ]);
  });

  it("uses GoHighLevel's hosted links for surveys and calendars", () => {
    expect(SURVEY_URL("s1")).toBe("https://api.leadconnectorhq.com/widget/survey/s1");
    expect(BOOKING_URL("c1")).toBe("https://api.leadconnectorhq.com/widget/booking/c1");
  });

  it("offers the kind that fits the trigger keyword first", () => {
    expect(preferredKinds("CALL")[0]).toBe("calendar");
    expect(preferredKinds("SURVEY")[0]).toBe("survey");
    expect(preferredKinds("TRIGGER")[0]).toBe("order");
    expect(preferredKinds("GUIDE")[0]).toBe("optin");
  });
});
