import { isDeepStrictEqual } from "node:util";
import type { PageEditorRules } from "@/templates/editor";
import { parseSection, type Section, type SectionIssueReason, type SectionType } from "@/templates/sections";

export type EditorIssueReason = SectionIssueReason | "not_allowed" | "duplicate_singleton";

export interface InvalidEntry {
  /** Position in the stored array (-1 when the stored value is not an array at all). */
  index: number;
  reason: EditorIssueReason;
  /** The stored value, exactly as found. */
  raw: unknown;
}

export interface PageAnalysis {
  /** Valid sections that are approved for this page by the template, in stored order. */
  sections: Section[];
  invalid: InvalidEntry[];
}

/**
 * Pure. Splits the stored JSON into editable sections and entries that cannot be edited safely:
 *  - not an array / not an object / unknown type / props that fail the strict schema / duplicate ids
 *  - valid sections whose type the template does not approve for this page, and extra copies of singleton types
 * Nothing is modified or dropped here; `invalid` carries the raw values for the recovery flow.
 */
export function analyzePage(raw: unknown, rules: PageEditorRules): PageAnalysis {
  if (!Array.isArray(raw)) return { sections: [], invalid: [{ index: -1, reason: "not_an_array", raw }] };
  const sections: Section[] = [];
  const invalid: InvalidEntry[] = [];
  const ids = new Set<string>();
  const singletonSeen = new Set<SectionType>();
  raw.forEach((item, index) => {
    const r = parseSection(item);
    if (!r.ok) return void invalid.push({ index, reason: r.issue.reason, raw: item });
    const s = r.section;
    if (ids.has(s.id)) return void invalid.push({ index, reason: "invalid_envelope", raw: item });
    if (!rules.allowed.includes(s.type)) return void invalid.push({ index, reason: "not_allowed", raw: item });
    if (rules.singletons.includes(s.type)) {
      if (singletonSeen.has(s.type)) return void invalid.push({ index, reason: "duplicate_singleton", raw: item });
      singletonSeen.add(s.type);
    }
    ids.add(s.id);
    sections.push(s);
  });
  return { sections, invalid };
}

export const sectionsEqual = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
