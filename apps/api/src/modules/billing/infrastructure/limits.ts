import type { PrismaClient } from "@prisma/client";
import { effectiveLimits, subscriptionState, type PlanLimits } from "@store-builder/shared/modules/billing/billing";
import { db } from "../../../lib/db.js";

/** What a store may hold now: its plan's limits while the subscription runs, otherwise the free limits. `free` = no running subscription. */
export interface StoreLimits extends PlanLimits {
  free: boolean;
}

/** Works inside a caller's transaction too (pass its client), so a count and the limit it is compared with are read together. */
export async function storeLimits(client: Pick<PrismaClient, "storeSubscription">, storeId: string, now: Date): Promise<StoreLimits> {
  const s = await client.storeSubscription.findUnique({ where: { storeId }, select: { endsAt: true, plan: { select: { maxProducts: true, maxStaff: true } } } });
  const state = subscriptionState(s?.endsAt ?? null, now);
  return { ...effectiveLimits(s?.plan ?? null, state), free: state.kind !== "active" };
}

export const storeLimitsNow = (storeId: string, now: Date = new Date()) => storeLimits(db, storeId, now);
