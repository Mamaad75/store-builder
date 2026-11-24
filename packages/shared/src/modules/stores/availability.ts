/**
 * ADR 0003 §0.2: a store's availability is COMPUTED from three independent conditions, each stored separately and changed only by its own
 * workflow (merchant publishing, platform suspension, billing). Nothing here writes anything; every gate in the API asks this function.
 */
export interface AvailabilityFacts {
  /** Merchant-controlled: status PUBLISHED with a live version. */
  published: boolean;
  /** Platform administrative suspension (Store.suspendedAt). */
  adminSuspended: boolean;
  /** Billing restriction (not built yet: always false). */
  billingRestricted: boolean;
}

export interface StoreAvailability {
  /** The storefront is public: pages, sitemap, product redirects. */
  storefrontLive: boolean;
  /** New business: cart, checkout, placing orders, customer sign-up and SMS codes, payment-method listing. */
  newBusiness: boolean;
  /** Shoppers' existing orders: details, tracking links, payment return, cancelling their own order. Always true (owner decision D1). */
  orderAccess: true;
  /** Paying an existing order: a new online payment session, a card-to-card receipt, seeing the store's card numbers. Off when suspended. */
  prepaidActions: boolean;
}

export function storeAvailability(f: AvailabilityFacts): StoreAvailability {
  const live = f.published && !f.adminSuspended && !f.billingRestricted;
  return { storefrontLive: live, newBusiness: live, orderAccess: true, prepaidActions: !f.adminSuspended };
}

/** A live store (what every "new business" path already checked before this function existed). */
export const OPEN_STORE: StoreAvailability = storeAvailability({ published: true, adminSuspended: false, billingRestricted: false });
