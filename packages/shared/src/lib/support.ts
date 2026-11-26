/**
 * How a merchant reaches platform support, shown on the panel's "راهنما و پشتیبانی" page. EMPTY on purpose: the owner fills in the real
 * channels before the pilot (nothing here is guessed). Only the filled ones are shown; a typo cannot ship because `support.test.ts`
 * checks the format of every value that is set.
 */
export interface SupportInfo {
  /** Telegram username without @, e.g. "my_support". */
  telegram: string | null;
  /** An Iranian phone or mobile number as the merchant should dial it, e.g. "02112345678" or "09121234567". */
  phone: string | null;
  email: string | null;
  /** Free text, e.g. "شنبه تا چهارشنبه، ۹ تا ۱۷". */
  hours: string | null;
}

export const SUPPORT: SupportInfo = { telegram: null, phone: null, email: null, hours: null };

export const TELEGRAM_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
export const PHONE_RE = /^0\d{10}$/;
export const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,200}\.[A-Za-z]{2,}$/;

export interface SupportChannel {
  kind: "telegram" | "phone" | "email";
  label: string;
  value: string;
  href: string;
}

/** The channels that are set, in the order they are shown. Pure so the page and its test agree. */
export function supportChannels(info: SupportInfo = SUPPORT): SupportChannel[] {
  const out: SupportChannel[] = [];
  if (info.telegram && TELEGRAM_RE.test(info.telegram)) out.push({ kind: "telegram", label: "تلگرام", value: `@${info.telegram}`, href: `https://t.me/${info.telegram}` });
  if (info.phone && PHONE_RE.test(info.phone)) out.push({ kind: "phone", label: "تلفن", value: info.phone, href: `tel:${info.phone}` });
  if (info.email && EMAIL_RE.test(info.email)) out.push({ kind: "email", label: "ایمیل", value: info.email, href: `mailto:${info.email}` });
  return out;
}
