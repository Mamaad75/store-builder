import { createHash, randomBytes } from "node:crypto";
import type { CartTokens } from "../application/ports.js";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 256 random bits, base64url (43 characters). Only the SHA-256 is stored: a database leak does not hand out carts. */
export const cartTokens: CartTokens = {
  create() {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: createHash("sha256").update(token).digest("hex") };
  },
  hash(token) {
    return TOKEN_RE.test(token) ? createHash("sha256").update(token).digest("hex") : null;
  },
};
