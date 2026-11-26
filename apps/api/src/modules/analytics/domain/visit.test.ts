import { describe, expect, it } from "vitest";
import { isCountable, isStoreLabel, visitorKey, type VisitInput } from "./visit.js";

const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const v = (o: Partial<VisitInput> = {}): VisitInput => ({ ip: "203.0.113.5", userAgent: BROWSER, doNotTrack: false, ...o });

describe("isCountable", () => {
  it("counts an ordinary browser", () => expect(isCountable(v())).toBe(true));
  it("does not count Do Not Track / Global Privacy Control", () => expect(isCountable(v({ doNotTrack: true }))).toBe(false));
  it("does not count an empty browser string", () => expect(isCountable(v({ userAgent: "" }))).toBe(false));
  it.each([
    "Googlebot/2.1 (+http://www.google.com/bot.html)", "Mozilla/5.0 (compatible; bingbot/2.0)", "Mozilla/5.0 AppleWebKit HeadlessChrome/126.0",
    "curl/8.0.1", "Wget/1.21", "python-requests/2.31", "facebookexternalhit/1.1", "Slackbot-LinkExpanding 1.0", "Mozilla/5.0 (compatible; UptimeRobot/2.0)", "Lighthouse",
  ])("does not count the automated client %s", (ua) => expect(isCountable(v({ userAgent: ua }))).toBe(false));
});

describe("isStoreLabel", () => {
  it("accepts a subdomain label only", () => {
    expect(isStoreLabel("my-shop1")).toBe(true);
    for (const bad of ["", "UPPER", "a.b", "a_b", "x".repeat(64), "../etc", undefined, 5, null]) expect(isStoreLabel(bad)).toBe(false);
  });
});

describe("visitorKey", () => {
  it("is stable for the same visitor on the same day and store", () => expect(visitorKey("s", "2026-11-26", "st1", v())).toBe(visitorKey("s", "2026-11-26", "st1", v())));
  it("changes with the day, the store, the address, the browser and the secret (so nobody can be followed or recomputed)", () => {
    const base = visitorKey("s", "2026-11-26", "st1", v());
    for (const other of [visitorKey("s", "2026-11-27", "st1", v()), visitorKey("s", "2026-11-26", "st2", v()), visitorKey("s", "2026-11-26", "st1", v({ ip: "203.0.113.6" })), visitorKey("s", "2026-11-26", "st1", v({ userAgent: BROWSER + "x" })), visitorKey("t", "2026-11-26", "st1", v())])
      expect(other).not.toBe(base);
  });
  it("uses only the first 300 characters of the browser string", () => expect(visitorKey("s", "d", "i", v({ userAgent: "a".repeat(400) }))).toBe(visitorKey("s", "d", "i", v({ userAgent: "a".repeat(300) + "different tail" }))));
});
