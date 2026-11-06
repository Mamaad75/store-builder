import { digitsToAscii } from "@/lib/text";
import type { StorefrontStore } from "../storefront-data";

/** Joins the storefront base path and an internal path ("/products" -> "/preview/abc/products"). */
export function makeHref(basePath: string) {
  const base = basePath.replace(/\/+$/, "");
  return (path: string): string => {
    if (!path.startsWith("/") || path.startsWith("//")) return base || "/";
    return path === "/" ? base || "/" : `${base}${path}`;
  };
}

export interface ContactLink {
  kind: "phone" | "email" | "address" | "instagram" | "telegram" | "whatsapp";
  label: string;
  value: string;
  /** Absent for plain text such as an address. */
  href?: string;
}

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/**
 * Builds contact/social links from store settings. Every URL is constructed here from a validated
 * value and a fixed scheme/host, so a stored value can never produce a `javascript:` or off-pattern
 * link. Values that do not validate are omitted, never rendered.
 */
export function buildContactLinks(contact: StorefrontStore["contact"], social: StorefrontStore["social"]): ContactLink[] {
  const out: ContactLink[] = [];
  const phone = digitsToAscii(contact.phone).replace(/[\s()-]/g, "");
  if (/^\+?\d{5,15}$/.test(phone)) out.push({ kind: "phone", label: "تلفن", value: contact.phone.trim(), href: `tel:${phone}` });
  const email = contact.email.trim();
  if (EMAIL_RE.test(email)) out.push({ kind: "email", label: "ایمیل", value: email, href: `mailto:${email}` });
  const address = contact.address.trim();
  if (address) out.push({ kind: "address", label: "آدرس", value: address });

  const ig = social.instagram.trim().replace(/^@/, "");
  if (/^[A-Za-z0-9._]{1,30}$/.test(ig)) out.push({ kind: "instagram", label: "اینستاگرام", value: `@${ig}`, href: `https://www.instagram.com/${ig}` });
  const tg = social.telegram.trim().replace(/^@/, "");
  if (/^[A-Za-z0-9_]{3,32}$/.test(tg)) out.push({ kind: "telegram", label: "تلگرام", value: `@${tg}`, href: `https://t.me/${tg}` });
  const wa = digitsToAscii(social.whatsapp).replace(/[\s()-]/g, "");
  if (/^\+?\d{7,15}$/.test(wa)) out.push({ kind: "whatsapp", label: "واتساپ", value: social.whatsapp.trim(), href: `https://wa.me/${wa.replace("+", "")}` });
  return out;
}
