import { MAX_VARIANTS_PER_STORE, VARIANT_SET_MESSAGES, replaceVariantsSchema, variantSetProblem, variantSummary } from "@store-builder/shared/modules/inventory/variants";
import { OutOfStockError, ReservationLostError, VariantLimitError } from "@store-builder/shared/modules/inventory/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { can, type StoreRole } from "@store-builder/shared/modules/access/permissions";
import { RELEASE_EXPIRED_BATCH, normaliseReservation, planVariantReplace, sellable } from "../domain/inventory.js";
import type { StockLedger, VariantReader, VariantUnitOfWork, VariantView } from "./ports.js";

const ID_RE = /^[a-z0-9]{1,64}$/;
/** Phase 3.2b: variants are linked one by one, so a product-level link must go first. */
export const PRODUCT_LINKED_MESSAGE = "قیمت این محصول به دلار یا طلا متصل است؛ برای افزودن تنوع، اول اتصال قیمت محصول را بردارید و بعد قیمت هر تنوع را متصل کنید.";

/** `a` is the resolved store access (store id + owner); the controller never passes request data as either. */
interface StoreScope {
  storeId: string;
  ownerId: string;
  /** The actor's role (from the resolved access); absent for server-side callers. */
  role?: StoreRole;
}

/** Removing a variant whose price is linked changes the LIVE price at once (its live row goes), so it is a publish-level act. */
export const LINKED_VARIANT_REMOVAL_MESSAGE = "قیمت این تنوع به دلار یا طلا متصل است و حذف آن قیمت فروشگاه را همان لحظه تغییر می‌دهد؛ این کار را مالک یا مدیر فروشگاه انجام دهد.";

export class InventoryService {
  constructor(
    private readonly reader: VariantReader,
    private readonly uow: VariantUnitOfWork,
    private readonly ledger: StockLedger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async listVariants(a: StoreScope, productId: unknown): Promise<VariantView[]> {
    if (typeof productId !== "string" || !ID_RE.test(productId)) throw new NotFoundError();
    const rows = await this.reader.list(a.storeId, productId);
    if (!rows) throw new NotFoundError();
    return rows;
  }

  /**
   * Replaces the whole variant set of a product (`[]` = no variants). Matching combinations keep their id (and reservations); removed
   * ones are deleted and their active reservations dropped. The product's price and stock become the summary of the new set.
   */
  async replaceVariants(a: StoreScope, productId: unknown, body: unknown): Promise<VariantView[]> {
    if (typeof productId !== "string" || !ID_RE.test(productId)) throw new NotFoundError();
    const parsed = replaceVariantsSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const incoming = parsed.data.variants;
    const problem = variantSetProblem(incoming);
    if (problem) throw new ValidationError({ variants: [VARIANT_SET_MESSAGES[problem]] });

    return this.uow.run(a.ownerId, a.storeId, async (w) => {
      if (!(await w.lockProduct(productId))) throw new NotFoundError();
      const linked = await w.linkedPrices(productId);
      if (linked.productLinked && incoming.length > 0) throw new ValidationError({ variants: [PRODUCT_LINKED_MESSAGE] });
      const existing = await w.list(productId);
      const plan = planVariantReplace(existing, incoming);
      // A variant whose price follows a link keeps its computed price (the link owns it; the sent value is ignored).
      const priceOf = (id: string, sent: number) => (linked.variantIds.includes(id) ? (existing.find((e) => e.id === id)?.price ?? sent) : sent);
      const after = (await w.countInStore()) - existing.length + incoming.length;
      if (incoming.length > existing.length && after > MAX_VARIANTS_PER_STORE) throw new VariantLimitError(MAX_VARIANTS_PER_STORE);
      const productLevel = existing.length === 0 && incoming.length > 0;
      if (plan.remove.length || productLevel) await w.dropReservations(productId, plan.remove, productLevel);
      const removesLinked = plan.remove.some((id) => linked.variantIds.includes(id));
      if (removesLinked && a.role !== undefined && !can(a.role, "publish")) throw new ValidationError({ variants: [LINKED_VARIANT_REMOVAL_MESSAGE] });
      if (plan.remove.length) await w.delete(plan.remove);
      if (removesLinked) await w.syncLivePrices(productId);
      for (const u of plan.update) await w.update(u.id, { options: u.input.options, optionsKey: u.optionsKey, sku: u.input.sku || null, price: priceOf(u.id, u.input.price), stockQuantity: u.input.stockQuantity, position: u.position });
      for (const i of plan.insert) await w.insert(productId, { options: i.input.options, optionsKey: i.optionsKey, sku: i.input.sku || null, price: i.input.price, stockQuantity: i.input.stockQuantity, position: i.position });
      const summary = variantSummary([...plan.update.map((u) => ({ price: priceOf(u.id, u.input.price), stockQuantity: u.input.stockQuantity })), ...plan.insert.map((i) => i.input)]);
      if (summary) await w.setProductSummary(productId, summary);
      return w.list(productId);
    });
  }

  /**
   * Holds stock for a checkout (3.3): all lines or none. Throws OutOfStockError listing every short line (with what is left), or
   * ValidationError for a malformed request. Re-reserving under the same `ref` is the caller's job (release first).
   */
  async reserve(storeId: string, ref: unknown, lines: readonly { productId: unknown; variantId?: unknown; quantity: unknown }[], ttlSeconds?: unknown): Promise<{ expiresAt: Date; lines: number }> {
    const req = normaliseReservation(ref, lines, ttlSeconds);
    if (!req.ok) throw new ValidationError({ reservation: [req.problem] });
    const expiresAt = new Date(this.clock().getTime() + req.ttlSeconds * 1000);
    const result = await this.ledger.reserve(storeId, req.ref, req.lines, expiresAt, (facts) =>
      req.lines.map((line, i) => ({ line, available: sellable(line, facts[i]!) })).filter((x) => x.available < x.line.quantity),
    );
    if (!result.reserved) throw new OutOfStockError(result.short.map((s) => ({ productId: s.line.productId, variantId: s.line.variantId, available: s.available })));
    return { expiresAt, lines: req.lines.length };
  }

  release(storeId: string, ref: string): Promise<number> {
    return this.ledger.release(storeId, ref);
  }

  /**
   * Turns a complete hold into an order (3.4). `expectedLines` is what `reserve` returned: if the hold is no longer complete, nothing is
   * consumed and ReservationLostError tells the checkout to reserve again (never an order with an unheld line).
   */
  async consume(storeId: string, ref: string, expectedLines: number): Promise<void> {
    if (!Number.isInteger(expectedLines) || expectedLines < 1) throw new ReservationLostError(); // nothing held is never "complete"
    if (!(await this.ledger.consume(storeId, ref, this.clock(), expectedLines))) throw new ReservationLostError();
  }

  /** db-cleanup: gives back the stock of abandoned checkouts. */
  releaseExpired(): Promise<number> {
    return this.ledger.releaseExpired(this.clock(), RELEASE_EXPIRED_BATCH);
  }
}
