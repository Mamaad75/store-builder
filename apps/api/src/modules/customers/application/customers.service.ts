import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { CustomerRepository } from "./ports.js";

export interface CustomerListItem {
  id: string;
  phone: string;
  name: string | null;
  phoneVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/** The merchant's view of the store's customers (phase 3.1; permission customers.view). Newest first, keyset pages by `before`. */
export class CustomersService {
  constructor(private readonly customers: CustomerRepository) {}

  async list(a: { storeId: string }, q: { before?: unknown; limit?: unknown }): Promise<CustomerListItem[]> {
    const limit = q.limit === undefined ? 50 : typeof q.limit === "string" && /^\d{1,3}$/.test(q.limit) ? Number(q.limit) : NaN;
    if (!(limit >= 1 && limit <= 100)) throw new ValidationError({ limit: ["عددی بین ۱ و ۱۰۰"] });
    let before: Date | undefined;
    if (q.before !== undefined) {
      before = typeof q.before === "string" && q.before.length <= 40 ? new Date(q.before) : new Date(NaN);
      if (Number.isNaN(before.getTime())) throw new ValidationError({ before: ["تاریخ نامعتبر است"] });
    }
    const rows = await this.customers.list(a.storeId, { before, limit });
    return rows.map((c) => ({ id: c.id, phone: c.phone, name: c.name, phoneVerifiedAt: c.phoneVerifiedAt, lastLoginAt: c.lastLoginAt, createdAt: c.createdAt }));
  }
}
