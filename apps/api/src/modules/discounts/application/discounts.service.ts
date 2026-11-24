import {
  MAX_DISCOUNTS_PER_STORE,
  discountInputSchema,
  evaluateDiscount,
  shopperCodeSchema,
  type DiscountCart,
  type DiscountResult,
  type DiscountRule,
} from "@store-builder/shared/modules/discounts/discounts";
import { DiscountCodeTakenError, DiscountLimitError } from "@store-builder/shared/modules/discounts/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { DiscountView } from "../domain/discounts.js";
import type { DiscountStore } from "./ports.js";

const ID_RE = /^[a-z0-9]{1,64}$/;

/** What the checkout learns about a code: the rule (for the order snapshot) and the result on this cart. */
export type Evaluation = { rule: DiscountRule | null; result: DiscountResult };

/**
 * Discount codes (phase 5.1, D51-1): the merchant's list, and the read-only evaluation the checkout summary uses. The binding check of the
 * usage limits happens in the order's own transaction (redeemDiscountInTx), under the discount's row lock.
 */
export class DiscountsService {
  constructor(
    private readonly repo: DiscountStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private parse(body: unknown) {
    const r = discountInputSchema.safeParse(body);
    if (!r.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of r.error.issues) (fieldErrors[String(i.path[0] ?? "_")] ??= []).push(i.message);
      throw new ValidationError(fieldErrors);
    }
    return r.data;
  }

  list(a: { storeId: string }): Promise<DiscountView[]> {
    return this.repo.list(a.storeId);
  }

  async create(a: { storeId: string }, body: unknown): Promise<DiscountView> {
    const r = await this.repo.create(a.storeId, this.parse(body), MAX_DISCOUNTS_PER_STORE);
    if (r === "taken") throw new DiscountCodeTakenError();
    if (r === "limit") throw new DiscountLimitError(MAX_DISCOUNTS_PER_STORE);
    return r;
  }

  async update(a: { storeId: string }, id: string, body: unknown): Promise<DiscountView> {
    if (!ID_RE.test(id)) throw new NotFoundError();
    const r = await this.repo.update(a.storeId, id, this.parse(body));
    if (r === "taken") throw new DiscountCodeTakenError();
    if (!r) throw new NotFoundError();
    return r;
  }

  async remove(a: { storeId: string }, id: string): Promise<void> {
    if (!ID_RE.test(id) || !(await this.repo.remove(a.storeId, id))) throw new NotFoundError();
  }

  /** The checkout's question: what does this code do to this cart for this shopper (phone/customer when known)? Read-only. */
  async evaluate(storeId: string, code: string, cart: DiscountCart, who: { phone: string | null; customerId: string | null }): Promise<Evaluation> {
    const c = shopperCodeSchema.safeParse(code);
    const rule = c.success && c.data ? await this.repo.findByCode(storeId, c.data) : null;
    if (!rule) return { rule: null, result: { ok: false, reason: "not_found" } };
    const usage = await this.repo.usage(storeId, rule.id, who);
    return { rule, result: evaluateDiscount(rule, cart, usage, this.clock()) };
  }
}
