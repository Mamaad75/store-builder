import type { Prisma } from "@prisma/client";

/**
 * M2: "a receipt waits for the merchant's review" — ONE definition, used by the overview's count and by the order list filter
 * (`?review=receipt`), so the number on the dashboard and the list it links to always agree. A SUBMITTED receipt counts only while the
 * order still awaits its card-to-card payment (a receipt left on a cancelled or expired order needs no review).
 */
export const RECEIPT_REVIEW_WHERE = {
  status: "AWAITING_PAYMENT",
  paymentMethod: "CARD_TRANSFER",
  receipts: { some: { status: "SUBMITTED" } },
} as const satisfies Prisma.OrderWhereInput;
