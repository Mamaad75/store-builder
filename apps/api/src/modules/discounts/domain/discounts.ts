import type { DiscountRule } from "@store-builder/shared/modules/discounts/discounts";

/** Phase 5.1 (D51-1). Pure: the merchant's list view of a discount (rule + how often it is in use). */
export interface DiscountView extends DiscountRule {
  title: string;
  /** Uses by orders that are not cancelled or expired. */
  used: number;
  createdAt: string;
}

/** A short, human label of the discount's value, for lists and order pages. */
export function discountLabel(r: Pick<DiscountRule, "type" | "value" | "maxDiscount">): string {
  if (r.type === "FREE_SHIPPING") return "ارسال رایگان";
  if (r.type === "FIXED") return `${r.value.toLocaleString("fa-IR")} تومان`;
  return `${r.value.toLocaleString("fa-IR")}٪${r.maxDiscount !== null ? ` (تا ${r.maxDiscount.toLocaleString("fa-IR")} تومان)` : ""}`;
}
