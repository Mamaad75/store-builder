/**
 * Persian/Arabic text normalisation shared by names, slugs and search.
 * The same functions run when writing and when querying, and the database CHECK constraints
 * (see the phase5 migration) reject values that skipped normalisation.
 */

const LETTER_MAP: Record<string, string> = {
  "ي": "ی", // ARABIC YEH -> PERSIAN YEH
  "ى": "ی", // ALEF MAKSURA -> PERSIAN YEH
  "ك": "ک", // ARABIC KAF -> PERSIAN KEHEH
};
const LETTER_RE = /[يىك]/g;
const TATWEEL_RE = /ـ/g;
// zero-width space, LRM, RLM, BOM, ... (ZWNJ U+200C is meaningful in Persian and is kept)
const INVISIBLE_RE = /[​‎‏‪-‮⁦-⁩﻿]/g;
const HARAKAT_RE = /[ً-ٰٟ]/g;

/** Arabic-Indic (U+0660..) and Persian (U+06F0..) digits -> ASCII. */
export function digitsToAscii(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** For display names: unicode NFKC, Persian letters, no tatweel/invisible marks, collapsed spaces. */
export function normalizeFa(input: string): string {
  return input
    .normalize("NFKC")
    .replace(LETTER_RE, (c) => LETTER_MAP[c] ?? c)
    .replace(TATWEEL_RE, "")
    .replace(INVISIBLE_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Like normalizeFa but keeps line breaks (for descriptions). */
export function normalizeFaText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(LETTER_RE, (c) => LETTER_MAP[c] ?? c)
    .replace(TATWEEL_RE, "")
    .replace(INVISIBLE_RE, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Lookup key for searching: normalised, ASCII digits, no harakat, ZWNJ as space, lowercase. */
export function makeSearchKey(input: string): string {
  return digitsToAscii(normalizeFa(input))
    .replace(HARAKAT_RE, "")
    .replace(/‌/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const SLUG_MAX = 80;

/** Letters (any script) and digits separated by single hyphens. */
export const SLUG_RE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

function truncateSlug(slug: string, max: number): string {
  return slug.slice(0, max).replace(/-+$/g, "");
}

/** Builds a URL slug from free text. Returns `fallback` if nothing usable remains. */
export function slugify(input: string, fallback = "item"): string {
  const base = makeSearchKey(input)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const slug = truncateSlug(base, SLUG_MAX);
  return slug.length > 0 ? slug : fallback;
}

/** True if `slug` is already in canonical form (what slugify would produce for it). */
export function isCanonicalSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= SLUG_MAX && SLUG_RE.test(slug) && slugify(slug, "") === slug;
}

/** Picks `base`, `base-2`, `base-3`, ... avoiding every slug in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = truncateSlug(base, SLUG_MAX - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Escapes LIKE wildcards so `%`, `_` and `\` in a user query are matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

/** Normalises a user search query (same normalisation as the stored search key). */
export function normalizeSearchQuery(q: string): string {
  return makeSearchKey(q.slice(0, 200));
}
