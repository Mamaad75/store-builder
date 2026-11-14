/** Success/error banners shown after a redirect. Only these codes are accepted from the URL. */
export const NOTICES = {
  "product-created": { severity: "success", text: "محصول با موفقیت ساخته شد. محصول جدید در وضعیت پیش‌نویس است." },
  "product-updated": { severity: "success", text: "تغییرات محصول ذخیره شد." },
  "product-deleted": { severity: "success", text: "محصول حذف شد." },
  "status-activated": { severity: "success", text: "محصول فعال شد." },
  "status-draft": { severity: "success", text: "محصول به پیش‌نویس بازگشت." },
  "status-archived": { severity: "success", text: "محصول بایگانی شد." },
  "status-invalid": { severity: "error", text: "این تغییر وضعیت مجاز نیست یا محصول از قبل در این وضعیت است." },
  "delete-unconfirmed": { severity: "error", text: "برای حذف، تأیید لازم است." },
  "conflict": { severity: "error", text: "محصول هم‌زمان تغییر کرده است. دوباره تلاش کنید." },
  "busy": { severity: "error", text: "فروشگاه در حال انجام عملیات دیگری است (مثلاً انتشار). تغییر شما ذخیره نشد؛ چند لحظه بعد دوباره تلاش کنید." },
  "category-created": { severity: "success", text: "دسته‌بندی ساخته شد." },
  "category-updated": { severity: "success", text: "نام دسته‌بندی تغییر کرد." },
  "category-deleted": { severity: "success", text: "دسته‌بندی حذف شد." },
  "category-deleted-moved": { severity: "success", text: "دسته‌بندی حذف شد و محصولات آن به «بدون دسته» منتقل شدند." },
  "category-not-empty": { severity: "error", text: "این دسته محصول دارد. برای حذف، انتقال محصولات به «بدون دسته» را تأیید کنید." },
  "category-error": { severity: "error", text: "انجام عملیات روی دسته‌بندی ممکن نشد." },
} as const;

export type NoticeCode = keyof typeof NOTICES;

export function getNotice(code: string | string[] | undefined) {
  const c = Array.isArray(code) ? code[0] : code;
  return c && Object.prototype.hasOwnProperty.call(NOTICES, c) ? NOTICES[c as NoticeCode] : null;
}
