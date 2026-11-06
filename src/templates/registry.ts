import type { TemplateModule } from "./types";
import { generalTemplate } from "./general";

/**
 * Every renderable template, keyed by `key@version`. Adding a template (or a new version of one) is
 * one import and one entry here: the engine, the routes and the data layer do not change.
 *
 * Persisted stores point at a `TemplateVersion` row (key + version). A version that is not registered
 * here (for example `coffee` before phase 9) resolves to `null` and is reported as unsupported; it is
 * never silently rendered with a different template.
 */
const TEMPLATES: readonly TemplateModule[] = [generalTemplate];

const index = new Map(TEMPLATES.map((t) => [`${t.key}@${t.version}`, t]));

export function resolveTemplate(key: string, version: number): TemplateModule | null {
  return index.get(`${key}@${version}`) ?? null;
}

export function listRegisteredTemplates(): { key: string; version: number; name: string }[] {
  return TEMPLATES.map((t) => ({ key: t.key, version: t.version, name: t.name }));
}
