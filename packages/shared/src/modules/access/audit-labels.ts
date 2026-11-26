import { ROLE_LABELS, STORE_ROLES, type StoreRole } from "./permissions.js";

/**
 * How the activity log shows an audit action: a short Persian sentence and a group to filter by. Pure and shared so the dashboard and a
 * test that lists every action the API writes stay in step (an action without a label would show as its raw code).
 */
export const AUDIT_GROUPS = ["store", "catalog", "orders", "pages", "team", "payments", "security"] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];
export const AUDIT_GROUP_LABELS: Readonly<Record<AuditGroup, string>> = {
  store: "فروشگاه و تنظیمات",
  catalog: "محصولات و دسته‌بندی‌ها",
  orders: "سفارش‌ها و تخفیف‌ها",
  pages: "صفحه‌ها",
  team: "تیم",
  payments: "پرداخت",
  security: "امنیت",
};

const A = (group: AuditGroup, label: string) => ({ group, label });
export const AUDIT_ACTIONS: Readonly<Record<string, { group: AuditGroup; label: string }>> = {
  "store.settings_updated": A("store", "تنظیمات فروشگاه تغییر کرد"),
  "store.category_changed": A("store", "نوع کسب‌وکار تغییر کرد"),
  "store.logo_set": A("store", "لوگو بارگذاری شد"),
  "store.logo_removed": A("store", "لوگو حذف شد"),
  "store.theme_switched": A("store", "قالب فروشگاه عوض شد"),
  "store.subdomain_claimed": A("store", "آدرس فروشگاه انتخاب یا تغییر کرد"),
  "store.published": A("store", "فروشگاه منتشر شد"),
  "store.unpublished": A("store", "انتشار فروشگاه لغو شد"),
  "store.version_live": A("store", "نسخهٔ منتشرشده تغییر کرد"),
  "store.deleted": A("store", "فروشگاه حذف شد"),
  "store.shipping_methods_replaced": A("store", "روش‌های ارسال تغییر کرد"),
  "store.sms_settings_updated": A("store", "تنظیمات پیامک سفارش تغییر کرد"),
  "platform.store_suspended": A("security", "فروشگاه توسط پلتفرم معلق یا آزاد شد"),
  "platform.store_suspension_amended": A("security", "پیام تعلیق فروشگاه تغییر کرد"),

  "product.created": A("catalog", "محصول ساخته شد"),
  "product.updated": A("catalog", "محصول ویرایش شد"),
  "product.deleted": A("catalog", "محصول حذف شد"),
  "product.status_changed": A("catalog", "وضعیت محصول تغییر کرد"),
  "product.image_set": A("catalog", "تصویر محصول بارگذاری شد"),
  "product.gallery_image_added": A("catalog", "تصویر به گالری محصول اضافه شد"),
  "product.gallery_image_removed": A("catalog", "تصویر گالری محصول حذف شد"),
  "product.gallery_image_primary": A("catalog", "تصویر اصلی محصول عوض شد"),
  "product.image_removed": A("catalog", "تصویر محصول حذف شد"),
  "product.variants_replaced": A("catalog", "گونه‌های محصول تغییر کرد"),
  "product.price_linked": A("catalog", "قیمت گونه به قیمت محصول متصل شد"),
  "product.price_unlinked": A("catalog", "قیمت گونه از قیمت محصول جدا شد"),
  "category.created": A("catalog", "دسته‌بندی ساخته شد"),
  "category.renamed": A("catalog", "دسته‌بندی تغییر نام یافت"),
  "category.deleted": A("catalog", "دسته‌بندی حذف شد"),

  "order.status_changed": A("orders", "وضعیت سفارش تغییر کرد"),
  "order.exported": A("orders", "فهرست سفارش‌ها به‌صورت CSV دریافت شد"),
  "order.tracking_set": A("orders", "کد رهگیری سفارش ثبت یا تغییر کرد"),
  "order.receipt_reviewed": A("orders", "رسید کارت‌به‌کارت بررسی شد"),
  "discount.created": A("orders", "کد تخفیف ساخته شد"),
  "discount.updated": A("orders", "کد تخفیف ویرایش شد"),
  "discount.deleted": A("orders", "کد تخفیف حذف شد"),

  "page.section_added": A("pages", "بخش به صفحه اضافه شد"),
  "page.section_updated": A("pages", "بخش صفحه ویرایش شد"),
  "page.section_removed": A("pages", "بخش صفحه حذف شد"),
  "page.dormant_section_removed": A("pages", "بخش غیرفعال صفحه حذف شد"),
  "page.section_moved": A("pages", "جای بخش صفحه عوض شد"),
  "page.section_image_set": A("pages", "تصویر بخش صفحه بارگذاری شد"),
  "page.section_image_removed": A("pages", "تصویر بخش صفحه حذف شد"),
  "page.visibility_changed": A("pages", "نمایش صفحه تغییر کرد"),
  "page.recovered": A("pages", "صفحه به حالت پیش‌فرض قالب برگشت"),

  "staff.invited": A("team", "همکار دعوت شد"),
  "staff.invitation_cancelled": A("team", "دعوت همکار لغو شد"),
  "staff.invitation_declined": A("team", "دعوت همکار رد شد"),
  "staff.joined": A("team", "همکار به تیم پیوست"),
  "staff.left": A("team", "همکار تیم را ترک کرد"),
  "staff.removed": A("team", "همکار از تیم حذف شد"),
  "staff.role_changed": A("team", "نقش همکار تغییر کرد"),

  "store.bank_cards_replaced": A("payments", "کارت‌های بانکی تغییر کرد"),
  "secret.set": A("payments", "کلید درگاه پرداخت ثبت شد"),
  "secret.deleted": A("payments", "کلید درگاه پرداخت حذف شد"),
  "security.reauth_failed": A("security", "تأیید رمز عبور ناموفق بود"),
  "security.sandbox_refused": A("security", "حالت آزمایشی درگاه در محیط واقعی رد شد"),
  "account.recovery_completed": A("security", "رمز عبور با پیوند بازیابی تعیین شد"),
};

/** The sentence for an action; an unknown one (a newer API) shows as its code instead of nothing. */
export const auditActionLabel = (action: string): string => AUDIT_ACTIONS[action]?.label ?? action;
export const auditActionGroup = (action: string): AuditGroup | null => AUDIT_ACTIONS[action]?.group ?? null;

/** The few metadata fields that are safe and useful to show next to an entry (short plain values); everything else stays out of the page. */
const SHOWN_META = ["role", "from", "to", "status", "name", "label"] as const;
export function auditDetails(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const m = metadata as Record<string, unknown>;
  const out: string[] = [];
  for (const k of SHOWN_META) {
    const v = m[k];
    if (typeof v !== "string" || v.length === 0 || v.length > 60) continue;
    out.push((STORE_ROLES as readonly string[]).includes(v) ? ROLE_LABELS[v as StoreRole] : v);
  }
  return out;
}
