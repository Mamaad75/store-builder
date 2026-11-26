import { MAX_PENDING_PER_CUSTOMER } from "@store-builder/shared/modules/reviews/reviews";

export const ANONYMOUS_AUTHOR = "خریدار";
export const DUPLICATE_MESSAGE = "شما قبلاً برای این محصول نظر داده‌اید.";
export const TOO_MANY_PENDING_MESSAGE = "چند نظر قبلی شما هنوز در انتظار تأیید است. پس از بررسی، نظر تازه ثبت کنید.";

/** The name shown with a review: the customer's own name (cut to the column), never their phone number. */
export function authorNameFor(customerName: string | null): string {
  const n = (customerName ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 60);
  return n.length > 0 ? n : ANONYMOUS_AUTHOR;
}

export const canQueueAnother = (pending: number): boolean => pending < MAX_PENDING_PER_CUSTOMER;
