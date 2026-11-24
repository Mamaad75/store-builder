import { MAX_TOKEN_LENGTH, isMerchantKind, plainToken, smsStoreName, spacedToken, type OrderSmsKind } from "@store-builder/shared/modules/notifications/order-sms";

/** Phase 3.6 (D36-1). Pure: who receives a kind, and the tokens of its template. */

export interface OrderFacts {
  number: number;
  total: number;
  storeName: string;
  link: string | null;
}

export interface LookupTokens {
  token: string;
  token2?: string;
  token10?: string;
}

export const recipientOf = (k: OrderSmsKind): "shopper" | "merchant" => (isMerchantKind(k) ? "merchant" : "shopper");

/**
 * token = the order number; token10 = the store name (at most 5 spaces); token2 = the order link for the shopper (when the store has an
 * address), the total in toman for the merchant. Nothing else about the order (no address, no items) goes into an SMS.
 */
export function tokensFor(k: OrderSmsKind, o: OrderFacts): LookupTokens | "link_too_long" {
  const base = { token: String(o.number), token10: spacedToken(smsStoreName(o.storeName)) };
  if (isMerchantKind(k)) return { ...base, token2: plainToken(String(o.total)) };
  if (!o.link) return base;
  // Review 3.6: a link is never cut (a cut link is a dead link); too long for the provider -> not sent, with the reason recorded.
  if (o.link.length > MAX_TOKEN_LENGTH || /\s/.test(o.link)) return "link_too_long";
  return { ...base, token2: o.link };
}

/** The first moment of the current calendar month (UTC): the monthly cap counts from it. */
export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
