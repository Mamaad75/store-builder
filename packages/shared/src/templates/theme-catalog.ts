import { appliancesTheme } from "./appliances/definition.js";
import { coffeeTheme } from "./coffee/definition.js";
import { fashionTheme } from "./fashion/definition.js";
import { generalTheme } from "./general/definition.js";
import { KIT_THEMES, KIT_THEMES_V2, KIT_THEMES_V3 } from "./kit/themes.js";
import type { ThemeDefinition } from "./theme.js";

/**
 * The pure catalog of registered themes (no React). Server code uses it to validate theme choices, to find the editor
 * spec of a store's theme and to resolve section definitions; `registry.ts` maps the same (key, version) pairs to the
 * React modules (a test keeps the two in sync). Adding a theme = its `definition.ts` + one line here + one line there.
 * Order = the order offered to merchants: the eight business themes (2026-11) first, then the four MVP themes, which stay
 * available unchanged (existing stores keep rendering exactly as before).
 */
export const THEME_CATALOG: readonly ThemeDefinition[] = [...KIT_THEMES_V3, ...KIT_THEMES_V2, ...KIT_THEMES, generalTheme, coffeeTheme, fashionTheme, appliancesTheme];

let extra: readonly ThemeDefinition[] = [];
let all: readonly ThemeDefinition[] = THEME_CATALOG;

export const allThemes = (): readonly ThemeDefinition[] => all;

export function resolveThemeDefinition(key: string, version: number): ThemeDefinition | null {
  return all.find((t) => t.key === key && t.version === version) ?? null;
}

/** Test seam: registers additional (fake) themes; an empty list restores the real catalog. */
export function setExtraThemesForTests(themes: readonly ThemeDefinition[]): void {
  extra = themes;
  all = themes.length === 0 ? THEME_CATALOG : [...THEME_CATALOG, ...extra];
}
