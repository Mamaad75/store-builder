import { z } from "zod";
import { cleanText } from "../../lib/clean-text.js";

/** Product reviews: a signed-in customer writes one per product; the merchant approves before the public sees it, and may answer. */
export const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = { PENDING: "در انتظار تأیید", APPROVED: "تأیید شده", REJECTED: "رد شده" };

export const REVIEW_BODY_MIN = 5;
export const REVIEW_BODY_MAX = 1000;
export const REPLY_MAX = 1000;
/** A customer's unreviewed backlog per store: stops one account from filling the moderation queue. */
export const MAX_PENDING_PER_CUSTOMER = 5;
/** Reviews shown per product page (the newest approved ones). */
export const PUBLIC_REVIEWS_LIMIT = 30;

const body = z.string().transform(cleanText).pipe(z.string().min(REVIEW_BODY_MIN, "نظر را کامل‌تر بنویسید (حداقل ۵ حرف).").max(REVIEW_BODY_MAX, "نظر بیش از حد طولانی است (حداکثر ۱۰۰۰ حرف)."));

export const submitReviewSchema = z
  .object({
    productSlug: z.string().min(1).max(200),
    rating: z.number({ error: "امتیاز را انتخاب کنید." }).int("امتیاز را انتخاب کنید.").min(1, "امتیاز را انتخاب کنید.").max(5, "امتیاز را انتخاب کنید."),
    body,
  })
  .strict();
export const reviewStatusSchema = z.object({ status: z.enum(REVIEW_STATUSES) }).strict();
/** An empty reply removes the merchant's answer. */
export const reviewReplySchema = z.object({ reply: z.string().transform(cleanText).pipe(z.string().max(REPLY_MAX, "پاسخ بیش از حد طولانی است (حداکثر ۱۰۰۰ حرف).")) }).strict();
export const reviewListQuerySchema = z.object({ status: z.enum(REVIEW_STATUSES).optional(), before: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
export const publicReviewsQuerySchema = z.object({ product: z.string().min(1).max(200) });

/** The average (one decimal) and count from the approved ratings; null average when there are none. Display only, never money. */
export function ratingSummary(count: number, sum: number): { count: number; average: number | null } {
  return { count, average: count > 0 ? Math.round((sum * 10) / count) / 10 : null };
}
