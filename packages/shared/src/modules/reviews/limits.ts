/** Limits of a product review, in a file with no dependencies (the storefront's browser code imports it; `reviews.ts` pulls in zod). */
export const REVIEW_BODY_MIN = 5;
export const REVIEW_BODY_MAX = 1000;
export const REPLY_MAX = 1000;
/** A customer's unreviewed backlog per store: stops one account from filling the moderation queue. */
export const MAX_PENDING_PER_CUSTOMER = 5;
/** Reviews shown per product page (the newest approved ones). */
export const PUBLIC_REVIEWS_LIMIT = 30;
