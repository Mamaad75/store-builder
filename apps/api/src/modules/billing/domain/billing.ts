import { subscriptionState, type SubscriptionState } from "@store-builder/shared/modules/billing/billing";

/** Messages for why an invitation code could not be used (shown under the code field). */
export const REDEEM_MESSAGES = {
  unknown_code: "این کد معرف پیدا نشد. آن را دوباره بررسی کنید.",
  own_code: "نمی‌توانید از کد فروشگاه خودتان استفاده کنید.",
  same_owner: "کد معرف فروشگاه دیگرِ خودتان قابل استفاده نیست.",
  already: "برای این فروشگاه قبلاً کد معرف ثبت شده است.",
  has_purchase: "کد معرف فقط پیش از اولین خرید اشتراک قابل ثبت است.",
} as const;
export type RedeemRefusal = keyof typeof REDEEM_MESSAGES;

export const NO_PLAN_MESSAGE = "پلن پیدا نشد.";
export const PLAN_INACTIVE_MESSAGE = "این پلن غیرفعال است و خرید تازه ندارد.";
export const INSUFFICIENT_MESSAGE = "اعتبار کیف پول برای این کاهش کافی نیست.";
export const WALLET_FULL_MESSAGE = "اعتبار کیف پول از سقف مجاز بیشتر می‌شود.";
export const PLAN_LIMIT_MESSAGE = "تعداد پلن‌ها به سقف رسیده است؛ یک پلن قدیمی را غیرفعال کنید و نام آن را عوض کنید.";

export const stateOf = (endsAt: Date | null, now: Date): SubscriptionState => subscriptionState(endsAt, now);
