import type { OrderSmsKind, OrderSmsPlatform } from "@store-builder/shared/modules/notifications/order-sms";
import type { LookupTokens, OrderFacts } from "../domain/order-sms.js";

/** What an order SMS needs from the order (the orders module reads it). */
export interface OrderReader {
  get(storeId: string, orderId: string): Promise<(OrderFacts & { phone: string; status: string }) | null>;
}

/** The platform's order-SMS settings, and the sender built from the platform's Kavenegar key (null = no key / secrets unavailable). */
export interface SmsPlatform {
  settings(): Promise<OrderSmsPlatform>;
  sender(): Promise<TemplateSender | null>;
}

export interface TemplateSender {
  /** Throws on any failure (the error carries no phone, key or provider text). */
  sendTemplate(phoneE164: string, template: string, tokens: LookupTokens): Promise<void>;
}

export interface StoreSmsChoice {
  enabled: boolean;
  merchantPhone: string | null;
}

export type ClaimOutcome = "go" | "duplicate" | "capped" | "phone_limit";

/** The SMS log of the stores (also their monthly counts). Every write is keyed by (event, kind). */
export interface SmsStore {
  choice(storeId: string): Promise<StoreSmsChoice>;
  saveChoice(storeId: string, c: StoreSmsChoice): Promise<StoreSmsChoice>;
  /**
   * ONE transaction under advisory locks of the store and of the recipient's phone hash: a row of this (event, kind) already SENT,
   * PENDING or SKIPPED -> "duplicate"; this month's PENDING+SENT of the same audience (shopper/merchant kinds) at or over `cap` -> SKIPPED
   * "capped"; the phone's PENDING+SENT of the last day (all stores) at or over `perPhonePerDay` -> SKIPPED "phone_limit"; else a PENDING
   * row (a FAILED one back to PENDING, counted from now), "go".
   */
  claim(
    r: { storeId: string; eventId: string; kind: OrderSmsKind; orderId: string },
    limits: { cap: number; since: Date; phone: string; perPhonePerDay: number; dayStart: Date },
  ): Promise<ClaimOutcome>;
  /** Records a decision not to send (ignored when a row of this event and kind exists). */
  skip(r: { storeId: string; eventId: string; kind: OrderSmsKind; orderId: string }, reason: string): Promise<void>;
  /** SENT with reason "uncertain" = the provider may have sent it (timeout): counted, never resent. */
  mark(eventId: string, kind: OrderSmsKind, status: "SENT" | "FAILED", reason: string | null): Promise<void>;
  /** This month's SENT + PENDING of one store. */
  used(storeId: string, since: Date): Promise<number>;
}
