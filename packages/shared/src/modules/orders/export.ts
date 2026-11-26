import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, type OrderStatus, type PaymentMethod } from "./orders.js";
import { provinceName } from "../checkout/provinces.js";

/**
 * The orders CSV (merchant export). Pure and tested: the API builds the file with it. Designed for Excel and Google Sheets:
 *  - UTF-8 with a byte-order mark, so Persian text opens correctly; CRLF line ends; numbers as plain ASCII integers (toman), no separators.
 *  - Cells are quoted when needed, and a cell that would start a FORMULA in a spreadsheet (= + - @, tab, carriage return) gets a leading
 *    apostrophe, so a buyer's name or address can never run as a formula on the merchant's computer (CSV injection, OWASP).
 *  - Phone numbers are written the way an Iranian reads them (09…), never as +98… (a leading + is a formula trigger and is lost in Excel).
 */
export const CSV_BOM = "﻿";
export const MAX_EXPORT_ROWS = 20_000;

const FORMULA_START = /^[=+\-@\t\r]/;
/** One CSV cell: neutralise a formula start, then quote if it holds a comma, quote, or line break. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // A negative number is data, not a formula; only TEXT that starts like a formula is neutralised.
  if (typeof value === "string" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvRow = (cells: (string | number | null | undefined)[]): string => cells.map(csvCell).join(",");

export const ORDER_CSV_HEADERS = [
  "شماره سفارش", "تاریخ ثبت (تهران)", "تاریخ ثبت (شمسی)", "وضعیت", "نام گیرنده", "موبایل", "استان", "شهر", "نشانی", "کد پستی",
  "روش ارسال", "هزینه ارسال (تومان)", "روش پرداخت", "کد تخفیف", "مبلغ تخفیف (تومان)", "جمع کالاها (تومان)", "جمع کل (تومان)",
  "کد رهگیری", "یادداشت خریدار", "کالاها",
] as const;

/** The parts of an order the export reads (what OrderView has). */
export interface ExportOrder {
  number: number;
  status: OrderStatus;
  createdAt: string;
  address: { recipientName: string; phone: string; province: string; city: string; line: string; postalCode: string };
  shipping: { name: string; cost: number };
  paymentMethod: PaymentMethod;
  discountCode: string | null;
  discountAmount: number;
  subtotal: number;
  total: number;
  trackingCode: string | null;
  note: string;
  items: { name: string; variantLabel: string; quantity: number }[];
}

const TEHRAN_OFFSET_MS = 210 * 60_000;
/** "2026-11-26 14:05" in Tehran time. */
export function tehranDateTime(iso: string): string {
  return new Date(new Date(iso).getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}
/** "1405/09/05" (Solar Hijri, Latin digits, zero padded) for the Tehran day of an instant. */
export function jalaliDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")}`;
}
/** "+989121234567" -> "09121234567"; anything else is written as stored. */
export const localPhone = (e164: string): string => (/^\+98\d{10}$/.test(e164) ? `0${e164.slice(3)}` : e164);

export function orderCsvRow(o: ExportOrder): string {
  return csvRow([
    o.number,
    tehranDateTime(o.createdAt),
    jalaliDate(o.createdAt),
    ORDER_STATUS_LABELS[o.status],
    o.address.recipientName,
    localPhone(o.address.phone),
    provinceName(o.address.province) ?? o.address.province,
    o.address.city,
    o.address.line,
    o.address.postalCode,
    o.shipping.name,
    o.shipping.cost,
    PAYMENT_METHOD_LABELS[o.paymentMethod],
    o.discountCode,
    o.discountAmount,
    o.subtotal,
    o.total,
    o.trackingCode,
    o.note,
    o.items.map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""} × ${i.quantity}`).join(" ؛ "),
  ]);
}

/** The whole file: BOM, header row, one row per order. */
export function ordersToCsv(orders: readonly ExportOrder[]): string {
  return CSV_BOM + [csvRow([...ORDER_CSV_HEADERS]), ...orders.map(orderCsvRow)].join("\r\n") + "\r\n";
}
