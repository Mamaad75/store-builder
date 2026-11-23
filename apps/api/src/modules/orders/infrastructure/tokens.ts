import { createHash, createHmac, hkdfSync } from "node:crypto";
import type { OrderTokens } from "../application/ports.js";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Order access tokens (phase 3.4): HMAC-SHA256 of the order id under a key DERIVED from the server secret with its own label (so it can
 * never stand in for a session or a sign-in code). Deterministic, so a retried "place order" gets the same token back; only the SHA-256
 * of the token is stored, so a database leak does not hand out order links.
 */
export function orderTokens(secret: string): OrderTokens {
  const key = Buffer.from(hkdfSync("sha256", secret, "store-builder", "order-access v1", 32));
  return {
    tokenFor: (orderId) => createHmac("sha256", key).update(orderId).digest("base64url"),
    hash: (token) => (TOKEN_RE.test(token) ? createHash("sha256").update(token).digest("hex") : null),
    requestKeyFor: (requestKey, owner) => createHmac("sha256", key).update(`request|${owner}|${requestKey}`).digest("hex"),
  };
}
