import { PUBLIC_REVIEWS_LIMIT, MAX_PENDING_PER_CUSTOMER, publicReviewsQuerySchema, ratingSummary, reviewListQuerySchema, reviewReplySchema, reviewStatusSchema, submitReviewSchema } from "@store-builder/shared/modules/reviews/reviews";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { DUPLICATE_MESSAGE, TOO_MANY_PENDING_MESSAGE } from "../domain/review.js";
import type { ReviewRepository } from "./ports.js";

const ID_RE = /^[a-z0-9]{1,64}$/;
type Issues = { issues: { path: PropertyKey[]; message: string }[] };
function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: Issues } }, body: unknown): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const out: Record<string, string[]> = {};
  for (const i of r.error.issues) (out[String(i.path[0] ?? "form")] ??= []).push(i.message);
  throw new ValidationError(out);
}
const known = (id: string) => {
  if (!ID_RE.test(id)) throw new NotFoundError();
  return id;
};

/** What a store page shows and accepts. `storeId` comes from the host (a live store), the customer from their verified session. */
export class PublicReviewsService {
  constructor(
    private readonly repo: ReviewRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async forProduct(storeId: string, query: unknown) {
    const { product: slug } = parse(publicReviewsQuerySchema, query);
    const p = await this.repo.activeProduct(storeId, slug);
    if (!p) throw new NotFoundError();
    const [reviews, totals] = await Promise.all([this.repo.approved(storeId, p.id, PUBLIC_REVIEWS_LIMIT), this.repo.approvedTotals(storeId, p.id)]);
    return { summary: ratingSummary(totals.count, totals.sum), reviews };
  }

  async submit(storeId: string, customerId: string, body: unknown): Promise<void> {
    const input = parse(submitReviewSchema, body);
    const p = await this.repo.activeProduct(storeId, input.productSlug);
    if (!p) throw new NotFoundError();
    const r = await this.repo.create(storeId, p.id, customerId, input.rating, input.body, this.clock(), MAX_PENDING_PER_CUSTOMER);
    if (r === "no_customer") throw new NotFoundError();
    if (r === "duplicate") throw new ValidationError({ body: [DUPLICATE_MESSAGE] });
    if (r === "too_many_pending") throw new ValidationError({ body: [TOO_MANY_PENDING_MESSAGE] });
  }
}

/** The merchant's moderation of ONE store's reviews. */
export class StoreReviewsService {
  constructor(
    private readonly repo: ReviewRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(a: { storeId: string }, query: unknown) {
    const q = parse(reviewListQuerySchema, query ?? {});
    const before = q.before ? new Date(q.before) : undefined;
    if (before && Number.isNaN(before.getTime())) throw new ValidationError({ before: ["تاریخ نامعتبر است"] });
    return this.repo.list(a.storeId, { status: q.status, before, limit: q.limit ?? 50 });
  }

  async setStatus(a: { storeId: string }, id: string, body: unknown): Promise<void> {
    const { status } = parse(reviewStatusSchema, body);
    if (!(await this.repo.setStatus(a.storeId, known(id), status, this.clock()))) throw new NotFoundError();
  }

  async reply(a: { storeId: string }, id: string, body: unknown): Promise<void> {
    const { reply } = parse(reviewReplySchema, body);
    if (!(await this.repo.setReply(a.storeId, known(id), reply === "" ? null : reply, this.clock()))) throw new NotFoundError();
  }
}
