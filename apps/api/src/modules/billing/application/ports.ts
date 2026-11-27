import type { PlanInput, PurchaseQuote, WalletEntryKind } from "@store-builder/shared/modules/billing/billing";
import type { RedeemRefusal } from "../domain/billing.js";

export interface PlanRow {
  id: string;
  name: string;
  description: string;
  priceToman: number;
  durationDays: number;
  active: boolean;
  createdAt: Date;
}
export interface SubscriptionRow {
  planId: string;
  planName: string;
  startsAt: Date;
  endsAt: Date;
}
export interface PurchaseRow {
  id: string;
  planName: string;
  priceToman: number;
  discountToman: number;
  walletUsedToman: number;
  cashToman: number;
  periodStart: Date;
  periodEnd: Date;
  note: string;
  createdAt: Date;
}
export interface EntryRow {
  id: string;
  amountToman: number;
  balanceAfter: number;
  kind: WalletEntryKind;
  note: string;
  createdAt: Date;
}
export interface ReferralRow {
  id: string;
  status: "PENDING" | "REWARDED";
  rewardToman: number;
  createdAt: Date;
  rewardedAt: Date | null;
}
export interface PlatformAudit {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

export interface PurchaseResult {
  purchase: PurchaseRow;
  quote: PurchaseQuote;
  subscription: SubscriptionRow;
  /** The inviter's credit, if this purchase earned one. */
  rewardedStoreId: string | null;
}

/** Every method that takes a store id is scoped to it. Money moves only inside one transaction under the wallet row's lock. */
export interface BillingRepository {
  plans(activeOnly: boolean): Promise<PlanRow[]>;
  createPlan(input: PlanInput, now: Date, audit: PlatformAudit): Promise<PlanRow | "limit">;
  updatePlan(id: string, input: PlanInput, now: Date, audit: PlatformAudit): Promise<PlanRow | null>;

  storeName(storeId: string): Promise<string | null>;
  subscription(storeId: string): Promise<SubscriptionRow | null>;
  purchases(storeId: string, limit: number): Promise<PurchaseRow[]>;
  wallet(storeId: string, limit: number): Promise<{ balanceToman: number; entries: EntryRow[] }>;
  /** The store's own code, made on first use. */
  referralCode(storeId: string): Promise<string>;
  referralsMade(storeId: string, limit: number): Promise<ReferralRow[]>;
  referredBy(storeId: string): Promise<ReferralRow | null>;
  redeem(storeId: string, code: string, now: Date): Promise<"ok" | RedeemRefusal>;

  recordPurchase(storeId: string, planId: string, o: { useWallet: boolean; note: string }, now: Date, audit: Omit<PlatformAudit, "metadata">): Promise<PurchaseResult | "no_store" | "no_plan" | "plan_inactive">;
  adjustWallet(storeId: string, amountToman: number, reason: string, now: Date, audit: Omit<PlatformAudit, "metadata">): Promise<{ balanceToman: number } | "no_store" | "insufficient" | "too_much">;
}
