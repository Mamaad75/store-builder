import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { PricingService } from "../application/pricing.service.js";

/** Linked prices of a store's products (phase 3.2b). Store and owner come from the resolved access context, never from request data. */
@Controller("stores/:storeId")
@UseGuards(SessionGuard, StoreAccessGuard)
export class PriceLinksController {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  /** The current dollar and gold rates (for the dashboard's link form). */
  @Get("rates")
  @RequirePermission("store.view")
  rates() {
    return this.pricing.currentRates();
  }

  @Get("products/:productId/price-links")
  @RequirePermission("store.view")
  list(@StoreAccess() a: StoreAccessContext, @Param("productId") productId: string) {
    return this.pricing.links(a, productId);
  }

  /**
   * Links the product (no variants) or one variant (`variantId`) to the dollar or to gold; the price is computed at once. Needs `publish`
   * (security review 3.2b): a linked price reaches the LIVE storefront without a publish, so it is a publish-level power.
   */
  @Put("products/:productId/price-link")
  @RequirePermission("publish")
  @Audit("product.price_linked", { type: "product", param: "productId" })
  set(@StoreAccess() a: StoreAccessContext, @Param("productId") productId: string, @Body() body: unknown) {
    return this.pricing.setLink(a, productId, body);
  }

  @Post("products/:productId/price-link/delete")
  @HttpCode(204)
  @RequirePermission("publish")
  @Audit("product.price_unlinked", { type: "product", param: "productId" })
  async remove(@StoreAccess() a: StoreAccessContext, @Param("productId") productId: string, @Body() body: unknown): Promise<void> {
    await this.pricing.removeLink(a, productId, body);
  }
}
