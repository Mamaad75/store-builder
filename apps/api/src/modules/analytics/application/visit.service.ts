import { tehranDayKey } from "@store-builder/shared/modules/analytics/analytics";
import type { Limiter, VisitStore } from "./ports.js";

import { isCountable, isStoreLabel, visitorKey, VISIT_RULE, type VisitInput } from "../domain/visit.js";

/** The shopper's address is the one the API sees (already behind the trusted proxy settings). */
export type VisitContext = VisitInput;

/**
 * Counts a page view of a live store. Anonymous by construction: the only thing kept per visitor is a one-way hash of
 * (server secret, day, store, address, browser) that changes every day, is deleted after two days and never leaves the database.
 * It answers "how many pages and how many different shoppers", nothing else.
 */
export class VisitService {
  constructor(
    private readonly store: VisitStore,
    private readonly deps: {
      /** The id of the live store behind a label, or null (unknown, not published, suspended). */
      liveStoreId(label: string): Promise<string | null>;
      limiter: Limiter;
      sha256(value: string): string;
      /** A server-only secret mixed into every hash, so a hash cannot be recomputed from a guessed address. */
      secret: string;
      clock?: () => Date;
    },
  ) {}

  /** Never throws for a normal refusal (bot, limit, unknown store): the beacon must not reveal anything. */
  async record(label: string, ctx: VisitContext): Promise<void> {
    if (!isStoreLabel(label) || !isCountable(ctx)) return;
    const storeId = await this.deps.liveStoreId(label);
    if (!storeId) return;
    const rl = await this.deps.limiter.consume(`visit:${storeId}:${this.deps.sha256(ctx.ip)}`, VISIT_RULE);
    if (!rl.allowed) return;
    const day = tehranDayKey(this.deps.clock?.() ?? new Date());
    await this.store.record(storeId, day, this.deps.sha256(visitorKey(this.deps.secret, day, storeId, ctx)));
  }
}
