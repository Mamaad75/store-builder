export const PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const STATUS_LABEL_FA: Record<ProductStatus, string> = {
  DRAFT: "پیش‌نویس",
  ACTIVE: "فعال",
  ARCHIVED: "بایگانی‌شده",
};

/**
 * Lifecycle (independent of stock):
 *   DRAFT    -> ACTIVE, ARCHIVED
 *   ACTIVE   -> DRAFT, ARCHIVED
 *   ARCHIVED -> DRAFT            (must be restored to DRAFT before it can be activated again)
 */
const ALLOWED: Record<ProductStatus, readonly ProductStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export function canTransition(from: ProductStatus, to: ProductStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function allowedTransitions(from: ProductStatus): readonly ProductStatus[] {
  return ALLOWED[from];
}

/** Persian action label for moving a product to `to`. */
export const TRANSITION_LABEL_FA: Record<ProductStatus, string> = {
  DRAFT: "بازگشت به پیش‌نویس",
  ACTIVE: "فعال‌سازی",
  ARCHIVED: "بایگانی",
};
