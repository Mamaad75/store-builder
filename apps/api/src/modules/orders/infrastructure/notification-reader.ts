import { db } from "../../../lib/db.js";
import { orderTokens } from "./tokens.js";

/** What an order SMS needs from an order (phase 3.6): no address, no items. */
export interface OrderForNotification {
  number: number;
  status: string;
  /** The shopper's mobile (E.164). */
  phone: string;
  total: number;
  storeName: string;
  /** The order link on the store's own host (the guest access token is in it), or null when the store has no subdomain. */
  link: string | null;
}

/** Reads one order of one store for its SMS; the link is derived like the one handed out when the order was placed. */
export function createOrderNotificationReader(o: { authSecret: string; storeOrigin: (label: string) => string }) {
  const tokens = orderTokens(o.authSecret);
  return {
    async get(storeId: string, orderId: string): Promise<OrderForNotification | null> {
      const r = await db.order.findFirst({
        where: { storeId, id: orderId },
        select: { number: true, status: true, phone: true, total: true, store: { select: { name: true, domains: { where: { kind: "SUBDOMAIN" }, select: { host: true }, take: 1 } } } },
      });
      if (!r) return null;
      const label = r.store.domains[0]?.host ?? null;
      return {
        number: r.number,
        status: r.status,
        phone: r.phone,
        total: Number(r.total),
        storeName: r.store.name,
        // The short form of the order page (/o/<token> = /orders/<token>): SMS tokens are limited in length (review 3.6).
        link: label ? `${o.storeOrigin(label)}/o/${tokens.tokenFor(orderId)}` : null,
      };
    },
  };
}
