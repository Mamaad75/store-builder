import { z } from "zod";
import { getSectionDefinition } from "./section-registry";
import { PAGE_TYPES, type Section } from "./sections";

/** A theme-specific section (`<themeKey>.<name>`): validated by its definition's schema, props typed loosely. */
export interface ExtraSection {
  id: string;
  type: `${string}.${string}`;
  props: Record<string, unknown>;
}

/** Any valid persisted section: a core section (typed props) or a theme-specific one. */
export type PageSection = Section | ExtraSection;

const sectionIdSchema = z.string().min(1).max(40);

export type SectionIssueReason = "not_an_array" | "invalid_envelope" | "unsupported_type" | "invalid_props";

export interface SectionIssue {
  index: number;
  id?: string;
  type?: string;
  reason: SectionIssueReason;
}

export type ParsedSection = { ok: true; section: PageSection } | { ok: false; issue: Omit<SectionIssue, "index"> };

/**
 * Validates ONE persisted section against the global section registry (core + every registered theme's types).
 * Never throws. A type that no registered theme defines is "unsupported_type" (not dormant: nothing can render it).
 */
export function parseSection(raw: unknown): ParsedSection {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, issue: { reason: "invalid_envelope" } };
  const { id, type, props } = raw as Record<string, unknown>;
  const idr = sectionIdSchema.safeParse(id);
  if (!idr.success || typeof type !== "string") return { ok: false, issue: { reason: "invalid_envelope" } };
  const def = getSectionDefinition(type);
  if (!def) return { ok: false, issue: { reason: "unsupported_type", id: idr.data, type } };
  if (typeof props !== "object" || props === null || Array.isArray(props)) return { ok: false, issue: { reason: "invalid_props", id: idr.data, type } };
  const pr = def.schema.safeParse(props);
  if (!pr.success) return { ok: false, issue: { reason: "invalid_props", id: idr.data, type } };
  return { ok: true, section: { id: idr.data, type, props: pr.data } as PageSection };
}

/**
 * Validates a persisted `sections` array. Invalid sections are SKIPPED (and reported as issues); the stored data is
 * never modified or deleted by rendering.
 */
export function parseSections(raw: unknown): { sections: PageSection[]; issues: SectionIssue[] } {
  if (!Array.isArray(raw)) return { sections: [], issues: [{ index: -1, reason: "not_an_array" }] };
  const sections: PageSection[] = [];
  const issues: SectionIssue[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const r = parseSection(item);
    if (!r.ok) issues.push({ index, ...r.issue });
    else if (seen.has(r.section.id)) issues.push({ index, id: r.section.id, type: r.section.type, reason: "invalid_envelope" });
    else {
      seen.add(r.section.id);
      sections.push(r.section);
    }
  });
  return { sections, issues };
}

/** Zod adapter: a section that parses, typed as `PageSection` (used by seeds and by the storefront contract). */
export const pageSectionSchema = z.unknown().transform((v, ctx): PageSection => {
  const r = parseSection(v);
  if (!r.ok) {
    ctx.addIssue({ code: "custom", message: `invalid section (${r.issue.reason})` });
    return z.NEVER;
  }
  return r.section;
});

export const pageDefinitionSchema = z.object({
  type: z.enum(PAGE_TYPES),
  title: z.string().min(1).max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60),
  sections: z.array(pageSectionSchema),
});

export type PageDefinition = z.infer<typeof pageDefinitionSchema>;
