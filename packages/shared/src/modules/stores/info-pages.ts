import { z } from "zod";
import { cleanText } from "../../lib/clean-text.js";

/**
 * The store's information pages (terms, shipping, returns, privacy, frequently asked questions) and the announcement bar. Plain text only
 * (see `parsePostBody`); they are part of the published site and go live with the next publish. Absent from the data when empty, so
 * existing stores and their published snapshots are unchanged.
 */
export const INFO_PAGE_KEYS = ["terms", "shipping", "returns", "privacy", "faq"] as const;
export type InfoPageKey = (typeof INFO_PAGE_KEYS)[number];
export const INFO_PAGE_LABELS: Readonly<Record<InfoPageKey, string>> = {
  terms: "قوانین و مقررات",
  shipping: "شرایط ارسال",
  returns: "بازگشت کالا",
  privacy: "حریم خصوصی",
  faq: "سؤالات پرتکرار",
};
export const INFO_PAGE_MAX = 8000;
export const ANNOUNCEMENT_MAX = 120;

const pageText = z.string().transform(cleanText).pipe(z.string().max(INFO_PAGE_MAX, "متن بیش از حد طولانی است (حداکثر ۸۰۰۰ حرف)."));
/** Every key optional: a save sends only the pages it changes; an empty text removes the page. */
export const infoPagesPatchSchema = z.object({ terms: pageText, shipping: pageText, returns: pageText, privacy: pageText, faq: pageText }).partial().strict();
export const infoPagesSchema = z.partialRecord(z.enum(INFO_PAGE_KEYS), z.string().max(INFO_PAGE_MAX));
export type InfoPages = Partial<Record<InfoPageKey, string>>;

/** Where the announcement may point: only the store's own pages (never an address typed by the merchant). */
export const ANNOUNCEMENT_LINKS = ["none", "products", "about", "contact", "blog", ...INFO_PAGE_KEYS] as const;
export type AnnouncementLink = (typeof ANNOUNCEMENT_LINKS)[number];
export const ANNOUNCEMENT_LINK_LABELS: Readonly<Record<AnnouncementLink, string>> = { none: "بدون پیوند", products: "محصولات", about: "دربارهٔ ما", contact: "تماس با ما", blog: "وبلاگ", ...INFO_PAGE_LABELS };
export const announcementSchema = z
  .object({
    text: z.string().transform((s) => cleanText(s).replace(/\s+/g, " ")).pipe(z.string().min(1, "متن اعلان را بنویسید.").max(ANNOUNCEMENT_MAX, "اعلان حداکثر ۱۲۰ حرف باشد.")),
    link: z.enum(ANNOUNCEMENT_LINKS).default("none"),
  })
  .strict();
export type Announcement = z.infer<typeof announcementSchema>;

/** The storefront path an announcement link points to. */
export const announcementPath = (link: AnnouncementLink): string | null =>
  link === "none" ? null : link === "products" || link === "about" || link === "contact" || link === "blog" ? `/${link}` : `/info/${link}`;

/** The pages that have text, in the fixed order; a page with only blanks does not exist. */
export function filledInfoPages(pages: InfoPages | undefined): { key: InfoPageKey; title: string; body: string }[] {
  return INFO_PAGE_KEYS.flatMap((key) => {
    const body = (pages?.[key] ?? "").trim();
    return body ? [{ key, title: INFO_PAGE_LABELS[key], body }] : [];
  });
}

/** A starting text for each page: general, honest wording the owner must read and adapt (the dashboard says so). */
export const INFO_PAGE_STARTERS: Readonly<Record<InfoPageKey, string>> = {
  terms: "## شرایط استفاده\nبا ثبت سفارش در این فروشگاه، قوانین زیر را می‌پذیرید.\n\n## ثبت و تأیید سفارش\nسفارش شما پس از بررسی موجودی و تأیید فروشگاه قطعی می‌شود. در صورت ناموجود بودن کالا با شما تماس گرفته می‌شود.\n\n## قیمت‌ها\nقیمت‌ها به تومان است و در لحظهٔ ثبت سفارش محاسبه می‌شود.\n\n## تماس\nبرای هر پرسش از راه‌های تماس همین سایت با ما در ارتباط باشید.",
  shipping: "## روش‌های ارسال\nسفارش‌ها با پیک یا پست ارسال می‌شود. هزینهٔ ارسال در مرحلهٔ تسویه، پیش از پرداخت نمایش داده می‌شود.\n\n## زمان ارسال\nسفارش‌ها معمولاً ظرف … روز کاری آماده و ارسال می‌شوند.\n\n## پیگیری\nپس از ارسال، کد رهگیری در صفحهٔ سفارش شما نمایش داده می‌شود.",
  returns: "## شرایط بازگشت کالا\nدر صورت مشکل در کالا یا اشتباه در ارسال، تا … روز پس از تحویل با ما تماس بگیرید.\n\n## چه کالایی قابل بازگشت است؟\nکالای استفاده‌نشده و در بستهٔ اصلی.\n\n## هزینهٔ بازگشت\nدر صورت اشتباه فروشگاه، هزینهٔ بازگشت با ماست.",
  privacy: "## اطلاعاتی که نگه می‌داریم\nنام، شمارهٔ تماس و نشانی شما فقط برای ثبت، ارسال و پیگیری سفارش نگه‌داری می‌شود.\n\n## به اشتراک‌گذاری\nاطلاعات شما به هیچ شخص ثالثی فروخته نمی‌شود و فقط در حد لازم برای ارسال سفارش به پیک یا پست داده می‌شود.\n\n## پرداخت\nاطلاعات کارت بانکی شما نزد این فروشگاه نگه‌داری نمی‌شود.",
  faq: "## چگونه سفارش بدهم؟\nمحصول را به سبد اضافه کنید و مراحل خرید را کامل کنید.\n\n## هزینهٔ ارسال چقدر است؟\nهزینهٔ ارسال پیش از پرداخت در صفحهٔ تسویه نمایش داده می‌شود.\n\n## چگونه سفارشم را پیگیری کنم؟\nاز بخش «حساب من» یا لینک سفارش، وضعیت و کد رهگیری را ببینید.",
};
