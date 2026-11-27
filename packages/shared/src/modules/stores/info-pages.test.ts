import { describe, expect, it } from "vitest";
import { parsePostBody } from "../blog/blog.js";
import { ANNOUNCEMENT_LINKS, INFO_PAGE_KEYS, INFO_PAGE_STARTERS, announcementPath, announcementSchema, filledInfoPages, infoPagesPatchSchema } from "./info-pages.js";

describe("info pages", () => {
  it("cleans text, accepts a partial patch, refuses unknown pages and too much text", () => {
    expect(infoPagesPatchSchema.parse({ terms: "  متن‮ قوانین  " })).toEqual({ terms: "متن قوانین" });
    expect(infoPagesPatchSchema.parse({ faq: "" })).toEqual({ faq: "" });
    expect(infoPagesPatchSchema.safeParse({ cookies: "x" }).success).toBe(false);
    expect(infoPagesPatchSchema.safeParse({ terms: "x".repeat(8001) }).success).toBe(false);
  });
  it("lists only the pages that have text, in a fixed order", () => {
    expect(filledInfoPages({ privacy: "  ", faq: "سؤال", terms: "قانون" }).map((p) => p.key)).toEqual(["terms", "faq"]);
    expect(filledInfoPages(undefined)).toEqual([]);
  });
  it("every page has a starter text that parses into headings and paragraphs", () => {
    for (const k of INFO_PAGE_KEYS) {
      const blocks = parsePostBody(INFO_PAGE_STARTERS[k]);
      expect(blocks.some((b) => b.type === "h"), k).toBe(true);
      expect(blocks.some((b) => b.type === "p"), k).toBe(true);
    }
  });
});

describe("announcement", () => {
  it("is one short line pointing at one of the store's own pages", () => {
    expect(announcementSchema.parse({ text: "  ارسال رایگان\n برای خرید بالای ۵۰۰ هزار  ", link: "products" })).toEqual({ text: "ارسال رایگان برای خرید بالای ۵۰۰ هزار", link: "products" });
    expect(announcementSchema.parse({ text: "سلام" }).link).toBe("none");
    expect(announcementSchema.safeParse({ text: "" }).success).toBe(false);
    expect(announcementSchema.safeParse({ text: "x".repeat(121) }).success).toBe(false);
    expect(announcementSchema.safeParse({ text: "سلام", link: "https://evil.example" }).success).toBe(false);
    expect(announcementSchema.safeParse({ text: "سلام", href: "/x" }).success).toBe(false);
  });
  it("maps each link to a fixed storefront path", () => {
    expect(announcementPath("none")).toBeNull();
    expect(announcementPath("products")).toBe("/products");
    expect(announcementPath("returns")).toBe("/info/returns");
    for (const l of ANNOUNCEMENT_LINKS) if (l !== "none") expect(announcementPath(l)).toMatch(/^\/[a-z]+(\/[a-z]+)?$/);
  });
});

describe("stored shape", () => {
  it("the stored/published map accepts any subset of the five pages and nothing else", async () => {
    const { infoPagesSchema } = await import("./info-pages.js");
    expect(infoPagesSchema.safeParse({}).success).toBe(true);
    expect(infoPagesSchema.safeParse({ terms: "x", faq: "y" }).success).toBe(true);
    expect(infoPagesSchema.safeParse({ cookies: "x" }).success).toBe(false);
  });
});
