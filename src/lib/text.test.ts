import { describe, expect, it } from "vitest";
import { digitsToAscii, escapeLike, isCanonicalSlug, makeSearchKey, normalizeFa, normalizeSearchQuery, slugify, uniqueSlug } from "./text";
import { formatToman, parseIntegerInput } from "./money";

describe("normalizeFa", () => {
  it("maps Arabic yeh/kaf/alef-maksura to the Persian letters", () => {
    expect(normalizeFa("علي")).toBe("علی");
    expect(normalizeFa("كتاب")).toBe("کتاب");
    expect(normalizeFa("موسى")).toBe("موسی");
  });
  it("applies NFKC (presentation forms), removes tatweel and invisible marks, collapses spaces", () => {
    expect(normalizeFa("ﻛﺘﺎﺏ")).toBe("کتاب");
    expect(normalizeFa("کــتاب")).toBe("کتاب");
    expect(normalizeFa("  چای ‏  سبز ​ ")).toBe("چای سبز");
  });
  it("keeps the zero-width non-joiner and Persian digits as typed", () => {
    expect(normalizeFa("می‌خواهم ۱۲۰۰ گرم")).toBe("می‌خواهم ۱۲۰۰ گرم");
  });
});

describe("digits and search key", () => {
  it("converts Persian and Arabic-Indic digits to ASCII", () => {
    expect(digitsToAscii("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
    expect(digitsToAscii("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });
  it("treats every letter/digit variant as the same search key", () => {
    const variants = ["چای سبز ۱۲۰ گرم", "چاي سبز 120 گرم", "چای‌سبز ١٢٠ گرم", "ﭼﺎﻱ ﺳﺒﺰ ۱۲۰ گرم", "چای سبز ۱۲۰ گرم".toUpperCase()];
    const keys = new Set(variants.map(makeSearchKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("چای سبز 120 گرم");
  });
  it("removes harakat and lowercases Latin", () => {
    expect(makeSearchKey("كِتَاب Tea")).toBe("کتاب tea");
  });
  it("a query typed with Arabic letters matches a name typed with Persian letters", () => {
    expect(normalizeSearchQuery("علي")).toBe(makeSearchKey("علی"));
    expect(normalizeSearchQuery("x".repeat(500)).length).toBe(200);
  });
});

describe("slugify", () => {
  it("builds Persian slugs with hyphens and ASCII digits", () => {
    expect(slugify("چای سبز ۱۲۰ گرم")).toBe("چای-سبز-120-گرم");
  });
  it("treats zero-width non-joiner as a separator and normalises yeh/kaf", () => {
    expect(slugify("می‌خواهم")).toBe("می-خواهم");
    expect(slugify("كتاب علي")).toBe("کتاب-علی");
  });
  it("handles Latin, punctuation and case", () => {
    expect(slugify("Green TEA!! (Premium)")).toBe("green-tea-premium");
  });
  it("falls back when nothing usable remains, and never exceeds 80 chars or ends with a hyphen", () => {
    expect(slugify("!!!", "product")).toBe("product");
    expect(slugify("😀😀")).toBe("item");
    const long = slugify("a ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("-")).toBe(false);
  });
  it("is idempotent and recognises canonical slugs", () => {
    const s = slugify("چای سبز");
    expect(slugify(s)).toBe(s);
    expect(isCanonicalSlug(s)).toBe(true);
    for (const bad of ["", "-a", "a-", "a--b", "A", "a b", "a/b", "علي", "x?"]) expect(isCanonicalSlug(bad)).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("adds numeric suffixes and respects the length limit", () => {
    expect(uniqueSlug("tea", new Set())).toBe("tea");
    expect(uniqueSlug("tea", new Set(["tea"]))).toBe("tea-2");
    expect(uniqueSlug("tea", new Set(["tea", "tea-2", "tea-3"]))).toBe("tea-4");
    const base = "a".repeat(80);
    const s = uniqueSlug(base, new Set([base]));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-2")).toBe(true);
  });
});

describe("money", () => {
  it("formats Toman with Persian digits, thousands separators and the unit", () => {
    expect(formatToman(12500)).toBe("۱۲٬۵۰۰ تومان");
    expect(formatToman(0)).toBe("۰ تومان");
    expect(formatToman(1_000_000_000)).toBe("۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان");
  });
  it("parses typed prices with Persian/Arabic digits and separators", () => {
    expect(parseIntegerInput("12500")).toBe(12500);
    expect(parseIntegerInput("۱۲٬۵۰۰")).toBe(12500);
    expect(parseIntegerInput("١٢,٥٠٠")).toBe(12500);
    expect(parseIntegerInput(" 0 ")).toBe(0);
  });
  it.each(["", "12.5", "-5", "+5", "1e3", "abc", "۱۲۰۰ تومان", "۱٫۵"])("rejects %j", (v) => {
    expect(Number.isNaN(parseIntegerInput(v))).toBe(true);
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards and the escape character itself", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
    expect(escapeLike("plain چای")).toBe("plain چای");
  });
});
