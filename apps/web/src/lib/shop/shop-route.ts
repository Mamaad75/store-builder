/**
 * Phase 3.3/3.4 storefront commerce: the browser on a STORE host calls `/api/shop/<rest>`, and the web proxy forwards it to the API's
 * `/api/public/stores/<label>/<rest>`, where <label> comes from the HOST (decideRoute), never from the path. So a store page can only
 * ever reach its own store's shopper routes, and the cart/customer cookies stay host-only on the store's own host.
 *
 * Only these shopper routes are forwarded (everything else on /api/shop is the neutral 404).
 */
const SHOP_PATH_RE =
  /^\/api\/shop\/(cart|cart\/items|checkout\/quote|checkout\/orders|checkout\/orders\/[A-Za-z0-9_-]{43}(\/cancel|\/pay|\/receipt)?|checkout\/payment-methods|checkout\/payments\/verify|customer\/(status|me|logout|logout-all|login|register|otp\/request|otp\/verify|addresses|orders)|customer\/addresses\/[a-z0-9]{1,64}|customer\/orders\/[a-z0-9]{1,64}(\/cancel|\/pay|\/receipt)?)$/;

export const SHOP_API_PREFIX = "/api/shop/";

/** The API path for a shop path on a store's own host, or null when the path is not a forwarded shopper route. */
export function shopApiPath(label: string, pathname: string): string | null {
  if (!SHOP_PATH_RE.test(pathname)) return null;
  return `/api/public/stores/${encodeURIComponent(label)}/${pathname.slice(SHOP_API_PREFIX.length)}`;
}
