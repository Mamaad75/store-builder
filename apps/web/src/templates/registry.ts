import type { TemplateModule } from "./types";
import { appliancesTemplate } from "./appliances";
import { coffeeTemplate } from "./coffee";
import { fashionTemplate } from "./fashion";
import { generalTemplate } from "./general";

/**
 * Every renderable template module, keyed by `key@version`. Adding a template (or a new version of one) is its folder,
 * one import and one entry here, plus the matching entry in `theme-catalog.ts` (a test keeps the two in sync); the
 * engine, the routes and the data layer do not change.
 *
 * Persisted stores point at a `TemplateVersion` row (key + version). A version that is not registered here resolves to
 * `null` and is reported as unsupported; it is never silently rendered with a different template.
 */
const TEMPLATES: readonly TemplateModule[] = [generalTemplate, coffeeTemplate, fashionTemplate, appliancesTemplate];

const index = new Map(TEMPLATES.map((t) => [`${t.key}@${t.version}`, t]));
const extra = new Map<string, TemplateModule>();

export function resolveTemplate(key: string, version: number): TemplateModule | null {
  const k = `${key}@${version}`;
  return extra.get(k) ?? index.get(k) ?? null;
}

export function listRegisteredTemplates(): { key: string; version: number; name: string }[] {
  return TEMPLATES.map((t) => ({ key: t.key, version: t.version, name: t.name }));
}

/** Test seam: registers (or, with an empty list, clears) extra templates so tests can prove template-specific behaviour. */
export function setExtraTemplatesForTests(templates: readonly TemplateModule[]): void {
  extra.clear();
  for (const t of templates) extra.set(`${t.key}@${t.version}`, t);
}
