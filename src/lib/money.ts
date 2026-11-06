import { digitsToAscii } from "./text";

export const MAX_PRICE_TOMAN = 1_000_000_000;

/** `۱۲٬۵۰۰ تومان` (Persian digits, thousands separators, explicit unit). The database stores only the integer. */
export function formatToman(amount: number): string {
  return `${amount.toLocaleString("fa-IR")} تومان`;
}

export function formatNumberFa(n: number): string {
  return n.toLocaleString("fa-IR");
}

/**
 * Parses a user-typed integer: accepts Persian/Arabic digits and thousands separators
 * (`,` `٬` `،` spaces). Anything else (decimals, letters, signs) yields NaN.
 */
export function parseIntegerInput(input: string): number {
  const cleaned = digitsToAscii(input).replace(/[,٬،\s]/g, "");
  if (!/^\d{1,15}$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}
