import { coffeeTheme } from "./coffee/definition";
import { fashionTheme } from "./fashion/definition";
import { generalTheme } from "./general/definition";
import type { ThemeDefinition } from "./theme";

/**
 * The pure catalog of registered themes (no React). Server code uses it to validate theme choices, to find the editor
 * spec of a store's theme and to resolve section definitions; `registry.ts` maps the same (key, version) pairs to the
 * React modules (a test keeps the two in sync). Adding a theme = its `definition.ts` + one line here + one line there.
 */
export const THEME_CATALOG: readonly ThemeDefinition[] = [generalTheme, coffeeTheme, fashionTheme];

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
