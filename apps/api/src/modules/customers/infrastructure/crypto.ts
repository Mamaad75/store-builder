import { createHmac, hkdfSync, randomInt, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { CustomerClaims, CustomerTokens, OtpCodec } from "../application/ports.js";
import { CUSTOMER_SESSION_SECONDS } from "../domain/otp.js";

/**
 * Keys of the customers module, each DERIVED from the server secret (AUTH_SECRET) with HKDF and its own label, so a code hash, a customer
 * token and a merchant session token can never stand in for one another.
 */
const derive = (secret: string, label: string) => Buffer.from(hkdfSync("sha256", secret, "store-builder", label, 32));

/** 6 digits from the CSPRNG; only an HMAC bound to (store, phone) is stored. */
export function otpCodec(secret: string): OtpCodec {
  const key = derive(secret, "customer-otp v1");
  return {
    newCode: () => String(randomInt(0, 1_000_000)).padStart(6, "0"),
    hash: (storeId, phone, code) => createHmac("sha256", key).update(`${storeId}|${phone}|${code}`).digest("hex"),
    same: (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")),
  };
}

const ISSUER = "store-builder";
const AUDIENCE = "store-builder:customer";

export function customerTokens(secret: string): CustomerTokens {
  const key = derive(secret, "customer-session v1");
  return {
    issue: (c: CustomerClaims) =>
      new SignJWT({ sid: c.storeId, av: c.authVersion })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(c.customerId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${CUSTOMER_SESSION_SECONDS}s`)
        .sign(key),
    async read(token: string) {
      if (token.length > 2048) return null;
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
        if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || typeof payload.av !== "number" || !Number.isInteger(payload.av)) return null;
        return { customerId: payload.sub, storeId: payload.sid, authVersion: payload.av };
      } catch {
        return null;
      }
    },
  };
}
