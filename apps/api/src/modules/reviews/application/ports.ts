import type { ReviewStatus } from "@store-builder/shared/modules/reviews/reviews";

export interface PublicReview {
  id: string;
  authorName: string;
  rating: number;
  body: string;
  reply: string | null;
  createdAt: Date;
}
export interface StoreReview extends PublicReview {
  productId: string;
  productName: string;
  status: ReviewStatus;
}

/** Every method takes the store id: a review, product or customer of another store does not exist for it. */
export interface ReviewRepository {
  /** An ACTIVE product of the store by its current slug. */
  activeProduct(storeId: string, slug: string): Promise<{ id: string; name: string } | null>;
  approved(storeId: string, productId: string, limit: number): Promise<PublicReview[]>;
  approvedTotals(storeId: string, productId: string): Promise<{ count: number; sum: number }>;
  /** One transaction: refuses a second review of the same product and a customer's backlog over the limit. */
  create(
    storeId: string,
    productId: string,
    customerId: string,
    rating: number,
    body: string,
    now: Date,
    maxPending: number,
  ): Promise<"created" | "duplicate" | "too_many_pending" | "no_customer">;
  list(storeId: string, f: { status?: ReviewStatus; before?: Date; limit: number }): Promise<StoreReview[]>;
  setStatus(storeId: string, id: string, status: ReviewStatus, now: Date): Promise<boolean>;
  setReply(storeId: string, id: string, reply: string | null, now: Date): Promise<boolean>;
}
