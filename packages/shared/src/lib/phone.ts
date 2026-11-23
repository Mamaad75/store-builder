import { digitsToAscii } from "./text.js";

/**
 * Iranian mobile numbers (phase 3.1): customers sign in with one, and the SMS provider is domestic. Input is forgiving (Persian or
 * Arabic-Indic digits, spaces, dashes, a leading 0, 98, 0098 or +98); the stored form is always E.164, "+989xxxxxxxxx" (the database CHECK
 * accepts nothing else). Anything that is not a mobile number of that shape is null.
 */
export const IRAN_MOBILE_E164 = /^\+989\d{9}$/;

export function normalizeIranMobile(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const digits = digitsToAscii(raw).replace(/[\s\-().]/g, "");
  const m = /^(?:\+98|0098|98|0)?(9\d{9})$/.exec(digits);
  return m ? `+98${m[1]}` : null;
}

/** For display to the merchant: 0912 345 6789. */
export function formatIranMobile(e164: string): string {
  return IRAN_MOBILE_E164.test(e164) ? `0${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}` : e164;
}

/** For logs and support: only the last 4 digits ("+98•••••••6789"). Phone numbers are personal data. */
export function maskPhone(e164: string): string {
  return `+98•••••••${e164.slice(-4)}`;
}
