import type { PlatformPaymentStatus, PurchaseQuote } from "@store-builder/shared/modules/billing/billing";
import type { PurchaseResult } from "./ports.js";

/** A payment a store makes to the platform (a plan, or a wallet top-up). */
export interface PaymentRow {
  id: string;
  storeId: string;
  userId: string;
  purpose: "PURCHASE" | "TOPUP";
  planId: string | null;
  planName: string | null;
  priceToman: number;
  discountToman: number;
  heldToman: number;
  amountToman: number;
  status: PlatformPaymentStatus;
  sandbox: boolean;
  authority: string | null;
  refId: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

export interface GatewayRequestPort {
  sandbox: boolean;
  merchantId: string;
  amountRial: number;
  description: string;
  callbackUrl: string;
  orderRef: string;
  attemptRef: string;
  mobile: string | null;
}
export type GatewayVerifyResult =
  | { outcome: "paid"; code: number; refId: string; cardPan: string | null; fee: number | null }
  | { outcome: "failed"; code: number }
  | { outcome: "pending"; code: number }
  | { outcome: "unknown"; code?: number | null };
/** The gateway (Zarinpal REST v4, the same adapter the stores' shoppers use). Never throws: every failure is a result. Amounts in rial. */
export interface PlatformGateway {
  startUrl(sandbox: boolean, authority: string): string;
  request(r: GatewayRequestPort): Promise<{ ok: true; authority: string } | { ok: false; code: number | null }>;
  verify(v: { sandbox: boolean; merchantId: string; amountRial: number; authority: string }): Promise<GatewayVerifyResult>;
  inquiry?(q: { sandbox: boolean; merchantId: string; authority: string }): Promise<{ status: "VERIFIED" | "PAID" | "IN_BANK" | "FAILED" | "REVERSED" | "unknown" }>;
}

/** The platform's own gateway settings: the switch, sandbox, and its merchant id (a platform secret). `ready` = a payment can be opened now. */
export interface GatewayConfig {
  current(): Promise<{ ready: boolean; sandbox: boolean; merchantId: string | null }>;
}

export type BeginPurchase =
  | "no_store" | "no_plan" | "plan_inactive" | "open_exists" | "cash_out_of_range" | "gateway_unavailable"
  | { kind: "activated"; result: PurchaseResult }
  | { kind: "opened"; payment: PaymentRow; quote: PurchaseQuote };
export type BeginTopup = "no_store" | "open_exists" | "wallet_full" | { kind: "opened"; payment: PaymentRow };
export type SettleResult = { kind: "paid"; payment: PaymentRow } | { kind: "late"; payment: PaymentRow } | { kind: "already"; payment: PaymentRow } | { kind: "missing" };

export interface PaymentsRepository {
  beginPurchase(i: { storeId: string; userId: string; planId: string; useWallet: boolean; sandbox: boolean; gatewayReady: boolean; now: Date }): Promise<BeginPurchase>;
  beginTopup(i: { storeId: string; userId: string; amountToman: number; sandbox: boolean; now: Date }): Promise<BeginTopup>;
  attachAuthority(id: string, authority: string): Promise<void>;
  /** Closes an OPEN payment as FAILED or EXPIRED and gives back the wallet credit it held; false when it was no longer open. */
  release(id: string, status: "FAILED" | "EXPIRED", now: Date): Promise<boolean>;
  /** The gateway says it is paid and verified: grants what was paid for, once. A payment already released is credited to the wallet instead (never lost). */
  settle(id: string, paid: { refId: string; cardPan: string | null }, now: Date): Promise<SettleResult>;
  byAuthority(storeId: string, authority: string): Promise<PaymentRow | null>;
  open(storeId: string): Promise<PaymentRow | null>;
  recent(storeId: string, limit: number): Promise<PaymentRow[]>;
  /** Open payments to look at (older than `olderThan`, due for a check), oldest first; each is pushed back by `backoffMs` so runs do not repeat themselves. */
  due(olderThan: Date, now: Date, limit: number, backoffMs: number): Promise<PaymentRow[]>;
}
