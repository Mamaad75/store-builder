/** Why a discount code was refused, and the sentence for each. No dependencies: the storefront's browser code reaches it through the error registry. */
export const DISCOUNT_REASONS = ["not_found", "changed", "inactive", "not_started", "expired", "min_order", "exhausted", "customer_limit", "first_order_only", "no_eligible_items", "no_shipping"] as const;
export type DiscountReason = (typeof DISCOUNT_REASONS)[number];
export const DISCOUNT_REASON_MESSAGES: Readonly<Record<DiscountReason, string>> = {
  not_found: "این کد تخفیف معتبر نیست.",
  changed: "شرایط این کد تخفیف همین حالا تغییر کرد؛ صفحه را دوباره بررسی کنید.",
  inactive: "این کد تخفیف فعال نیست.",
  not_started: "زمان استفاده از این کد تخفیف هنوز نرسیده است.",
  expired: "مهلت استفاده از این کد تخفیف تمام شده است.",
  min_order: "مبلغ سفارش برای این کد تخفیف کافی نیست.",
  exhausted: "ظرفیت استفاده از این کد تخفیف تمام شده است.",
  customer_limit: "شما قبلاً از این کد تخفیف استفاده کرده‌اید.",
  first_order_only: "این کد تخفیف فقط برای اولین خرید از این فروشگاه است.",
  no_eligible_items: "این کد تخفیف برای کالاهای سبد شما نیست.",
  no_shipping: "این کد ارسال رایگان است؛ ابتدا روش ارسال را انتخاب کنید.",
};
