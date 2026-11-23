import type { Request } from "express";
import type { ApiConfig } from "../../../config/env.js";
import { readCookie } from "../../../auth/cookie.js";
import { ipLimitKey, type CustomerAuthService } from "../../customers/customers.api.js";
import type { Shopper } from "../application/checkout.service.js";

/** Host-only, __Host- prefixed over https (like the customer cookie): it lives on the store's own host. */
export const cartCookieName = (c: Pick<ApiConfig, "secureCookies">) => (c.secureCookies ? "__Host-sb_cart" : "sb_cart");
const customerCookieName = (c: Pick<ApiConfig, "secureCookies">) => (c.secureCookies ? "__Host-sb_customer" : "sb_customer");

/** Reads the shopper from the request: the cart cookie, and the customer session of THIS store (verified, never trusted from the client). */
export async function shopperOf(req: Request, config: ApiConfig, auth: CustomerAuthService, storeId: string | null): Promise<Shopper> {
  const customerToken = readCookie(req.headers.cookie, customerCookieName(config)) ?? undefined;
  const customer = storeId && customerToken ? await auth.current(storeId, customerToken) : null;
  return { cartToken: readCookie(req.headers.cookie, cartCookieName(config)), customerId: customer?.id ?? null, ipKey: ipLimitKey(req.ip ?? "unknown") };
}

