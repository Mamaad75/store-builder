import { z } from "zod";
import { codeOf, linkFromInput, priceLinkInputSchema, priceOf, RATE_CODES, type RateCode } from "@store-builder/shared/modules/pricing/pricing";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { LINK_PROBLEM_FA, type LinkProblem } from "../domain/pricing.js";
import type { LinkReader, LinkUnitOfWork, LinkView, RateStore } from "./ports.js";

const ID_RE = /^[a-z0-9]{1,64}$/;
const targetSchema = z.object({ variantId: z.string().regex(ID_RE).nullable().default(null) }).strict();
const setSchema = z.object({ variantId: z.string().regex(ID_RE).nullable().default(null), link: z.unknown() }).strict();

interface StoreScope {
  storeId: string;
  ownerId: string;
}

const problem = (p: LinkProblem, field = "link") => new ValidationError({ [field]: [LINK_PROBLEM_FA[p]] });

/**
 * Merchant side of linked prices (phase 3.2b): link a product (or one variant) to the dollar or to gold, see the links and the current
 * rates, remove a link. A link computes the price at once, in the same store mutation, so the dashboard shows the result immediately.
 */
export class PricingService {
  constructor(
    private readonly reader: LinkReader,
    private readonly uow: LinkUnitOfWork,
    private readonly rates: RateStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** The current rates and their age, for the dashboard. */
  async currentRates(): Promise<Record<RateCode, { rateToman: number; appliedAt: Date } | null>> {
    const cur = await this.rates.current();
    return Object.fromEntries(RATE_CODES.map((c) => [c, cur[c] ?? null])) as Record<RateCode, { rateToman: number; appliedAt: Date } | null>;
  }

  async links(a: StoreScope, productId: unknown): Promise<LinkView[]> {
    if (typeof productId !== "string" || !ID_RE.test(productId)) throw new NotFoundError();
    const rows = await this.reader.list(a.storeId, productId);
    if (!rows) throw new NotFoundError();
    return rows;
  }

  async setLink(a: StoreScope, productId: unknown, body: unknown): Promise<LinkView> {
    if (typeof productId !== "string" || !ID_RE.test(productId)) throw new NotFoundError();
    const outer = setSchema.safeParse(body);
    if (!outer.success) throw new ValidationError(outer.error.flatten().fieldErrors as Record<string, string[]>);
    const parsed = priceLinkInputSchema.safeParse(outer.data.link);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const input = parsed.data;
    const variantId = outer.data.variantId;

    return this.uow.run(a.ownerId, a.storeId, async (w) => {
      const product = await w.lockProduct(productId);
      if (!product) throw new NotFoundError();
      // Read under the product lock, the lock repricing also takes: the price written here is never older than a run that finished.
      const rate = (await this.rates.current())[codeOf(input)];
      if (!rate) throw problem("no_rate");
      const link = linkFromInput(input, rate.rateToman);
      if (!link) throw problem("bad_conversion");
      const priced = priceOf(link, rate.rateToman);
      if (!priced.ok) throw problem("out_of_range");
      if (product.variantIds.length > 0 && variantId === null) throw problem("variant_required", "variantId");
      if (product.variantIds.length === 0 && variantId !== null) throw problem("variant_not_allowed", "variantId");
      if (variantId !== null && !product.variantIds.includes(variantId)) throw problem("unknown_variant", "variantId");
      const view = await w.upsert(productId, variantId, link, priced.priceToman, rate.appliedAt);
      await w.applyPrice(productId, variantId, priced.priceToman, this.clock());
      return view;
    });
  }

  /** The price stays at its last computed value and becomes editable again; the live storefront shows the published price until the next publish. */
  async removeLink(a: StoreScope, productId: unknown, body: unknown): Promise<void> {
    if (typeof productId !== "string" || !ID_RE.test(productId)) throw new NotFoundError();
    const parsed = targetSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    await this.uow.run(a.ownerId, a.storeId, async (w) => {
      if (!(await w.lockProduct(productId))) throw new NotFoundError();
      if (!(await w.remove(productId, parsed.data.variantId))) throw new NotFoundError();
      await w.dropLive(productId, parsed.data.variantId, this.clock());
    });
  }
}
