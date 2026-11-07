import { allThemes } from "./theme-catalog";
import { SECTION_DEFAULTS, SECTION_LABELS } from "./section-defaults";
import { IMAGE_SECTION_TYPES, SECTION_FIELDS } from "./section-fields";
import { SECTION_TYPES, sectionPropsSchemas, type SectionType } from "./sections";
import { EXTRA_SECTION_TYPE_RE, type SectionDefinition, type ThemeDefinition } from "./theme";

/** Core section definitions: shared by every theme (each theme must render all of them). */
const CORE: Record<string, SectionDefinition> = Object.fromEntries(
  SECTION_TYPES.map((t: SectionType) => [
    t,
    {
      type: t,
      label: SECTION_LABELS[t],
      schema: sectionPropsSchemas[t] as unknown as SectionDefinition["schema"],
      defaults: SECTION_DEFAULTS[t] as unknown as Record<string, unknown>,
      fields: SECTION_FIELDS[t],
      image: IMAGE_SECTION_TYPES.includes(t),
    } satisfies SectionDefinition,
  ]),
);

let extraIndex: Map<string, SectionDefinition> | null = null;
let indexedFor: readonly unknown[] | null = null;

function buildExtraIndex(themes: readonly ThemeDefinition[]): Map<string, SectionDefinition> {
  const m = new Map<string, SectionDefinition>();
  for (const theme of themes) {
    for (const d of theme.sectionDefinitions) {
      if (!EXTRA_SECTION_TYPE_RE.test(d.type) || !d.type.startsWith(`${theme.key}.`)) throw new Error(`invalid theme section type ${d.type}`);
      if (CORE[d.type] || m.has(d.type)) throw new Error(`duplicate section type ${d.type}`);
      m.set(d.type, d);
    }
  }
  return m;
}

/**
 * Global lookup used to validate ANY persisted section, independent of the active theme: core types plus the types of
 * every registered theme. (Whether a valid section is ACTIVE for a store is decided by the active theme's editor spec.)
 */
function index(): Map<string, SectionDefinition> {
  const themes = allThemes(); // a new array whenever the registered themes change (see the catalog's test seam)
  if (!extraIndex || indexedFor !== themes) {
    extraIndex = buildExtraIndex(themes);
    indexedFor = themes;
  }
  return extraIndex;
}

export function getSectionDefinition(type: string): SectionDefinition | null {
  if (Object.prototype.hasOwnProperty.call(CORE, type)) return CORE[type]!;
  return index().get(type) ?? null;
}

export function listSectionDefinitions(): SectionDefinition[] {
  return [...Object.values(CORE), ...index().values()];
}

export const isCoreSectionType = (type: string): type is SectionType => Object.prototype.hasOwnProperty.call(CORE, type);

/** Fresh, schema-validated default props of any registered section type (throws if a default stopped satisfying its schema). */
export function defaultPropsOf(type: string): Record<string, unknown> {
  const def = getSectionDefinition(type);
  if (!def) throw new Error(`unknown section type ${type}`);
  return def.schema.parse(structuredClone(def.defaults)) as Record<string, unknown>;
}
