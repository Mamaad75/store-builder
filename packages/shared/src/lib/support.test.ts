import { describe, expect, it } from "vitest";
import { EMAIL_RE, PHONE_RE, SUPPORT, supportChannels, TELEGRAM_RE } from "./support.js";

describe("support contact", () => {
  it("whatever is filled in is well formed (a typo here would ship a broken link to every merchant)", () => {
    if (SUPPORT.telegram) expect(SUPPORT.telegram).toMatch(TELEGRAM_RE);
    if (SUPPORT.phone) expect(SUPPORT.phone).toMatch(PHONE_RE);
    if (SUPPORT.email) expect(SUPPORT.email).toMatch(EMAIL_RE);
    if (SUPPORT.hours) expect(SUPPORT.hours.length).toBeLessThanOrEqual(120);
  });

  it("shows only the channels that are set, with safe links", () => {
    expect(supportChannels({ telegram: null, phone: null, email: null, hours: null })).toEqual([]);
    const all = supportChannels({ telegram: "my_support", phone: "02112345678", email: "help@example.ir", hours: null });
    expect(all.map((c) => [c.kind, c.href])).toEqual([["telegram", "https://t.me/my_support"], ["phone", "tel:02112345678"], ["email", "mailto:help@example.ir"]]);
  });

  it("ignores a malformed value instead of rendering a broken or unsafe link", () => {
    expect(supportChannels({ telegram: "has space", phone: "12345", email: "javascript:alert(1)", hours: null })).toEqual([]);
    expect(supportChannels({ telegram: "@@x", phone: "09121234567", email: "a b@c.ir", hours: null }).map((c) => c.kind)).toEqual(["phone"]);
  });
});
