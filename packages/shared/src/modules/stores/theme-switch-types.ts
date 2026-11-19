import type { CompatibilityResult } from "../pages/compat.js";

/** The switch would introduce a new invalid section / violate a required-section rule. Carries the report. */
export class ThemeSwitchBlockedError extends Error {
  constructor(public readonly result: CompatibilityResult) {
    super("Theme switch blocked by compatibility problems");
    this.name = "ThemeSwitchBlockedError";
  }
}

export interface ThemeRef {
  key: string;
  version: number;
  name: string;
  description: string;
}

export interface ThemeSwitchReport extends CompatibilityResult {
  storeId: string;
  /** The draft revision this report was computed from; pass it to `switchTheme`. */
  draftRevision: number;
  current: ThemeRef;
  target: ThemeRef;
  /** True when the target is the theme the store already uses (nothing to do). */
  sameTheme: boolean;
}
