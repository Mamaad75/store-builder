import { isDeepStrictEqual } from "node:util";
import type { PageEditorRules } from "@/templates/editor";
import { parseSection, type PageSection, type SectionIssueReason } from "@/templates/section-parse";

export type EditorIssueReason = SectionIssueReason | "duplicate_singleton";

/** A stored entry that cannot be edited safely (corrupted). Editing is blocked until the explicit recovery. */
export interface InvalidEntry {
  /** Position in the stored array (-1 when the stored value is not an array at all). */
  index: number;
  reason: EditorIssueReason;
  /** The stored value, exactly as found. */
  raw: unknown;
}

/**
 * A valid stored section. `raw` is the stored value, exactly as found: it is what gets written back for every entry
 * an operation does not deliberately change, so nothing is ever normalised, reordered or rewritten by analysis.
 *  - active:  the theme approves this section type for this page (rendered, editable)
 *  - dormant: valid and known to the registry, but not approved by the ACTIVE theme (kept in place, not rendered;
 *             it becomes active again when a theme that approves it is used)
 */
export interface Entry {
  kind: "active" | "dormant";
  section: PageSection;
  raw: unknown;
  /** Position in the stored array; set by `analyzePage` (entries created by an edit have none yet). */
  index?: number;
}

export interface PageAnalysis {
  /** Every valid entry (active and dormant), in stored order. */
  entries: Entry[];
  /** Active sections, in stored order. */
  sections: PageSection[];
  dormant: Entry[];
  invalid: InvalidEntry[];
}

/**
 * Pure. Classifies the stored JSON into three states (never modifying it):
 *   valid+active, valid+dormant, invalid/corrupted (not an array/object, unknown type in EVERY theme, props failing the
 *   strict schema, duplicate id, extra copy of an active singleton type).
 */
export function analyzePage(raw: unknown, rules: PageEditorRules): PageAnalysis {
  if (!Array.isArray(raw)) return { entries: [], sections: [], dormant: [], invalid: [{ index: -1, reason: "not_an_array", raw }] };
  const entries: Entry[] = [];
  const invalid: InvalidEntry[] = [];
  const ids = new Set<string>();
  const singletonSeen = new Set<string>();
  raw.forEach((item, index) => {
    const r = parseSection(item);
    if (!r.ok) return void invalid.push({ index, reason: r.issue.reason, raw: item });
    const s = r.section;
    if (ids.has(s.id)) return void invalid.push({ index, reason: "invalid_envelope", raw: item });
    if (!rules.allowed.includes(s.type)) {
      ids.add(s.id);
      return void entries.push({ kind: "dormant", section: s, raw: item, index });
    }
    if (rules.singletons.includes(s.type)) {
      if (singletonSeen.has(s.type)) return void invalid.push({ index, reason: "duplicate_singleton", raw: item });
      singletonSeen.add(s.type);
    }
    ids.add(s.id);
    entries.push({ kind: "active", section: s, raw: item, index });
  });
  return {
    entries,
    sections: entries.filter((e) => e.kind === "active").map((e) => e.section),
    dormant: entries.filter((e) => e.kind === "dormant"),
    invalid,
  };
}

/** The array to persist: every entry's stored value (unchanged entries are written back verbatim). */
export const serializeEntries = (entries: readonly Entry[]): unknown[] => entries.map((e) => e.raw);

export const sectionsEqual = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

/** `imageId` of a stored section, if it carries one (used to protect/release media of dormant sections too). */
export function imageIdOf(section: PageSection): string | null {
  const id = (section.props as Record<string, unknown>).imageId;
  return typeof id === "string" && id.length > 0 ? id : null;
}
