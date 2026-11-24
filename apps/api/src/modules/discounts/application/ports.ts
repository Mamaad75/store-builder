import type { DiscountInput, DiscountRule, DiscountUsage } from "@store-builder/shared/modules/discounts/discounts";
import type { DiscountView } from "../domain/discounts.js";

/** Discount codes of one store. Every query is bound to the store id. */
export interface DiscountStore {
  list(storeId: string): Promise<DiscountView[]>;
  get(storeId: string, id: string): Promise<DiscountView | null>;
  findByCode(storeId: string, code: string): Promise<DiscountRule | null>;
  /** "taken" = another discount of the store has the code; "limit" = the store already has `max`. */
  create(storeId: string, d: DiscountInput, max: number): Promise<DiscountView | "taken" | "limit">;
  update(storeId: string, id: string, d: DiscountInput): Promise<DiscountView | "taken" | null>;
  /** Deleting a code keeps the orders' snapshot (code and amount) and drops its use history. */
  remove(storeId: string, id: string): Promise<boolean>;
  /** Uses of a discount by orders not cancelled/expired; per customer when a phone (or customer) is known; prior orders of that phone. */
  usage(storeId: string, discountId: string, who: { phone: string | null; customerId: string | null }): Promise<DiscountUsage>;
}
