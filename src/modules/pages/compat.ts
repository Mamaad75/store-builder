import type { PageType } from "@/templates/sections";
import type { ThemeDefinition } from "@/templates/theme";
import { analyzePage, imageIdOf, type EditorIssueReason } from "./analyze";

/**
 * Theme-switch compatibility. PURE: it reads the stored sections and the two themes' editor specs and describes what the
 * owner would see after the switch. It never changes anything - a switch itself does not touch a single page (the
 * active/dormant/invalid state is derived from the stored JSON and the ACTIVE theme on every read).
 *
 * Per stored entry the state under the current theme and under the target theme is computed with the very same
 * `analyzePage` the editor uses, so the report cannot disagree with what the editor will show after the switch.
 */
export type EntryState = "active" | "dormant" | "invalid";

export type EntryChange =
  | "stays_active"
  | "becomes_dormant" // active now, not approved by the target: kept in place, not rendered
  | "becomes_active" // dormant now, approved by the target: reappears, nothing was lost
  | "stays_dormant"
  | "stays_invalid" // PRE-EXISTING invalid data: unchanged by the switch, never blocks it
  | "becomes_invalid" // NEW invalid state introduced by the target (e.g. extra copy of a singleton): BLOCKS the switch
  | "invalid_becomes_active" // invalid now only because of the current theme (duplicate singleton); valid in the target
  | "invalid_becomes_dormant";

export interface EntryCompat {
  /** Position in the stored array (-1 when the stored value is not an array at all). */
  index: number;
  id: string | null;
  type: string | null;
  from: EntryState;
  to: EntryState;
  change: EntryChange;
  /** Why the entry is invalid under the target (only for `becomes_invalid` / `stays_invalid`). */
  reason?: EditorIssueReason;
  hasImage: boolean;
  blocking: boolean;
}

export interface RequiredViolation {
  /** A section type the target theme requires on this page that would have no active copy. */
  type: string;
  /** True when the page ALREADY lacks it under the current theme (the violation is not caused by the switch). */
  alsoMissingNow: boolean;
}

export interface PageCompat {
  type: PageType;
  title: string;
  isVisible: boolean;
  entries: EntryCompat[];
  missingRequired: RequiredViolation[];
}

export type Blocker =
  | { kind: "new_invalid"; pageType: PageType; index: number; sectionType: string | null; reason: EditorIssueReason }
  | { kind: "missing_required"; pageType: PageType; sectionType: string };

export interface CompatSummary {
  becomeDormant: number;
  becomeActive: number;
  stayActive: number;
  stayDormant: number;
  preExistingInvalid: number;
  newInvalid: number;
  missingRequired: number;
}

export interface CompatibilityResult {
  pages: PageCompat[];
  summary: CompatSummary;
  blockers: Blocker[];
  /** False when there is at least one blocker: the owner has to fix the page under the CURRENT theme first. */
  canSwitch: boolean;
}

export interface PageInput {
  type: PageType;
  title: string;
  isVisible: boolean;
  sections: unknown;
}

const idOfRaw = (raw: unknown): string | null => (raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string" ? (raw as { id: string }).id : null);
const typeOfRaw = (raw: unknown): string | null => (raw && typeof raw === "object" && typeof (raw as { type?: unknown }).type === "string" ? (raw as { type: string }).type : null);
const rawHasImage = (raw: unknown): boolean => {
  const id = raw && typeof raw === "object" ? (raw as { props?: { imageId?: unknown } }).props?.imageId : undefined;
  return typeof id === "string" && id.length > 0;
};

export function computeCompatibility(pages: readonly PageInput[], from: ThemeDefinition, to: ThemeDefinition): CompatibilityResult {
  const summary: CompatSummary = { becomeDormant: 0, becomeActive: 0, stayActive: 0, stayDormant: 0, preExistingInvalid: 0, newInvalid: 0, missingRequired: 0 };
  const blockers: Blocker[] = [];
  const out: PageCompat[] = [];

  for (const page of pages) {
    const now = analyzePage(page.sections, from.editor.pages[page.type]);
    const next = analyzePage(page.sections, to.editor.pages[page.type]);

    const stateNow = new Map<number, { state: EntryState; type: string | null; id: string | null; hasImage: boolean; reason?: EditorIssueReason }>();
    for (const e of now.entries) stateNow.set(e.index!, { state: e.kind, type: e.section.type, id: e.section.id, hasImage: imageIdOf(e.section) !== null });
    for (const i of now.invalid) stateNow.set(i.index, { state: "invalid", type: typeOfRaw(i.raw), id: idOfRaw(i.raw), hasImage: rawHasImage(i.raw), reason: i.reason });
    const stateNext = new Map<number, { state: EntryState; reason?: EditorIssueReason }>();
    for (const e of next.entries) stateNext.set(e.index!, { state: e.kind });
    for (const i of next.invalid) stateNext.set(i.index, { state: "invalid", reason: i.reason });

    const entries: EntryCompat[] = [];
    for (const [index, a] of [...stateNow.entries()].sort((x, y) => x[0] - y[0])) {
      const b = stateNext.get(index) ?? { state: "invalid" as EntryState };
      let change: EntryChange;
      if (a.state === "invalid") change = b.state === "invalid" ? "stays_invalid" : b.state === "active" ? "invalid_becomes_active" : "invalid_becomes_dormant";
      else if (b.state === "invalid") change = "becomes_invalid";
      else if (a.state === "active") change = b.state === "active" ? "stays_active" : "becomes_dormant";
      else change = b.state === "active" ? "becomes_active" : "stays_dormant";

      const blocking = change === "becomes_invalid";
      if (change === "stays_active") summary.stayActive++;
      else if (change === "becomes_dormant") summary.becomeDormant++;
      else if (change === "becomes_active" || change === "invalid_becomes_active") summary.becomeActive++;
      else if (change === "stays_dormant" || change === "invalid_becomes_dormant") summary.stayDormant++;
      else if (change === "stays_invalid") summary.preExistingInvalid++;
      else summary.newInvalid++;

      const reason = change === "becomes_invalid" ? b.reason : change === "stays_invalid" ? b.reason ?? a.reason : undefined;
      entries.push({ index, id: a.id, type: a.type, from: a.state, to: b.state, change, ...(reason ? { reason } : {}), hasImage: a.hasImage, blocking });
      if (blocking) blockers.push({ kind: "new_invalid", pageType: page.type, index, sectionType: a.type, reason: reason ?? "invalid_envelope" });
    }

    const missingRequired: RequiredViolation[] = [];
    for (const type of to.editor.pages[page.type].required) {
      if (next.sections.some((s) => s.type === type)) continue;
      const alsoMissingNow = from.editor.pages[page.type].required.includes(type) && !now.sections.some((s) => s.type === type);
      missingRequired.push({ type, alsoMissingNow });
      blockers.push({ kind: "missing_required", pageType: page.type, sectionType: type });
      summary.missingRequired++;
    }

    out.push({ type: page.type, title: page.title, isVisible: page.isVisible, entries, missingRequired });
  }
  return { pages: out, summary, blockers, canSwitch: blockers.length === 0 };
}
