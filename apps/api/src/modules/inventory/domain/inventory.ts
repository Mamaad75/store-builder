import { optionsKeyOf, type VariantInput } from "@store-builder/shared/modules/inventory/variants";

/**
 * Inventory rules (phase 3.2, D32-1). Pure: no I/O.
 *
 * Stock model: `stockQuantity` (product or variant) is the SELLABLE quantity. A reservation takes its quantity out of it at once
 * (atomically, all or nothing), so two buyers can never be promised the same last item; releasing gives it back, consuming (the order
 * is placed, 3.4) keeps it out for good.
 */

/** How long a checkout may hold stock: default and upper bound (seconds). */
export const RESERVATION_TTL_DEFAULT_S = 15 * 60;
export const RESERVATION_TTL_MAX_S = 60 * 60;
/** One reservation (one cart) holds at most this many distinct lines and this many units per line (also a DB CHECK). */
export const MAX_RESERVATION_LINES = 50;
export const MAX_LINE_QUANTITY = 1000;
/** Batch size of the expired-reservation sweep run by db-cleanup. */
export const RELEASE_EXPIRED_BATCH = 500;

const REF_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_RE = /^[a-z0-9]{1,64}$/;

export interface ExistingVariant {
  id: string;
  optionsKey: string;
}

export interface VariantPlan {
  /** Same combination as before: updated in place, so its id (and any reservation on it) survives. */
  update: { id: string; input: VariantInput; optionsKey: string; position: number }[];
  insert: { input: VariantInput; optionsKey: string; position: number }[];
  /** Combinations no longer offered. */
  remove: string[];
}

/** Turns "the new full set" into in-place updates, inserts and removals, matched by combination. */
export function planVariantReplace(existing: readonly ExistingVariant[], incoming: readonly VariantInput[]): VariantPlan {
  const byKey = new Map(existing.map((e) => [e.optionsKey, e.id]));
  const plan: VariantPlan = { update: [], insert: [], remove: [] };
  const kept = new Set<string>();
  incoming.forEach((input, position) => {
    const optionsKey = optionsKeyOf(input.options);
    const id = byKey.get(optionsKey);
    if (id) {
      kept.add(id);
      plan.update.push({ id, input, optionsKey, position });
    } else plan.insert.push({ input, optionsKey, position });
  });
  plan.remove = existing.filter((e) => !kept.has(e.id)).map((e) => e.id);
  return plan;
}

export interface ReservationLine {
  productId: string;
  variantId: string | null;
  quantity: number;
}

export type ReservationProblem = "bad_ref" | "no_lines" | "too_many_lines" | "bad_line" | "bad_ttl";

/**
 * Validates a reservation request and merges repeated lines (same product and variant). The merged lines come back in lock order
 * (product id, then variant id), the order every stock writer takes its row locks in, so two checkouts cannot deadlock.
 */
export function normaliseReservation(
  ref: unknown,
  lines: readonly { productId: unknown; variantId?: unknown; quantity: unknown }[],
  ttlSeconds: unknown,
): { ok: true; ref: string; lines: ReservationLine[]; ttlSeconds: number } | { ok: false; problem: ReservationProblem } {
  if (typeof ref !== "string" || !REF_RE.test(ref)) return { ok: false, problem: "bad_ref" };
  const ttl = ttlSeconds === undefined ? RESERVATION_TTL_DEFAULT_S : ttlSeconds;
  if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 60 || ttl > RESERVATION_TTL_MAX_S) return { ok: false, problem: "bad_ttl" };
  if (lines.length === 0) return { ok: false, problem: "no_lines" };
  if (lines.length > MAX_RESERVATION_LINES * 4) return { ok: false, problem: "too_many_lines" }; // bounded before any work
  const merged = new Map<string, ReservationLine>();
  for (const l of lines) {
    const variantId = l.variantId === undefined || l.variantId === null ? null : l.variantId;
    if (typeof l.productId !== "string" || !ID_RE.test(l.productId)) return { ok: false, problem: "bad_line" };
    if (variantId !== null && (typeof variantId !== "string" || !ID_RE.test(variantId))) return { ok: false, problem: "bad_line" };
    if (typeof l.quantity !== "number" || !Number.isInteger(l.quantity) || l.quantity < 1) return { ok: false, problem: "bad_line" };
    const key = `${l.productId}|${variantId ?? ""}`;
    const prev = merged.get(key);
    const quantity = (prev?.quantity ?? 0) + l.quantity;
    if (quantity > MAX_LINE_QUANTITY) return { ok: false, problem: "bad_line" };
    merged.set(key, { productId: l.productId, variantId, quantity });
  }
  if (merged.size > MAX_RESERVATION_LINES) return { ok: false, problem: "too_many_lines" };
  return { ok: true, ref, lines: [...merged.values()].sort(lockOrder), ttlSeconds: ttl };
}

export function lockOrder(a: ReservationLine, b: ReservationLine): number {
  return a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : (a.variantId ?? "") < (b.variantId ?? "") ? -1 : (a.variantId ?? "") > (b.variantId ?? "") ? 1 : 0;
}

/** What a line can get right now, as read under the row locks. `hasVariants` products are sold only by variant. */
export interface StockFacts {
  productActive: boolean;
  hasVariants: boolean;
  /** Product stock (no variant asked) or the variant's stock; null = the product or variant does not exist in this store. */
  available: number | null;
}

/** 0 when the line cannot be sold at all (missing, not active, variant required or not allowed). */
export function sellable(line: ReservationLine, facts: StockFacts): number {
  if (facts.available === null || !facts.productActive) return 0;
  if (facts.hasVariants !== (line.variantId !== null)) return 0;
  return facts.available;
}
