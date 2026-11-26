import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiConfig } from "../../../config/env.js";
import { CONFIG } from "../../../config/tokens.js";
import { SessionGuard } from "../../../auth/session.guard.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { CheckoutService, shopperOf } from "../../checkout/checkout.api.js";
import { CustomerAuthService } from "../../customers/customers.api.js";
import { PublicReviewsService, StoreReviewsService } from "../application/reviews.service.js";

/**
 * The reviews of a live store's products, on the store's own host (`/api/shop/reviews`). Reading is public (approved reviews only);
 * writing needs the customer session of THIS store. A store that is not live is the same 404 as a missing one.
 */
@Controller("public/stores/:label/reviews")
export class PublicReviewsController {
  constructor(
    @Inject(PublicReviewsService) private readonly reviews: PublicReviewsService,
    @Inject(CheckoutService) private readonly checkout: CheckoutService,
    @Inject(CustomerAuthService) private readonly auth: CustomerAuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  @Get()
  async list(@Param("label") label: string, @Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    return this.reviews.forProduct(await this.checkout.liveStoreId(label), query);
  }

  @Post()
  @HttpCode(204)
  async submit(@Param("label") label: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    const storeId = await this.checkout.liveStoreId(label);
    const s = await shopperOf(req, this.config, this.auth, storeId);
    if (!s.customerId) throw new UnauthorizedException();
    await this.reviews.submit(storeId, s.customerId, body);
  }
}

/** The merchant's moderation queue: approve, reject, answer. Owner and manager (`content.manage`). */
@Controller("stores/:storeId/reviews")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreReviewsController {
  constructor(@Inject(StoreReviewsService) private readonly reviews: StoreReviewsService) {}

  @Get()
  @RequirePermission("content.manage")
  list(@StoreAccess() a: StoreAccessContext, @Query() query: unknown) {
    return this.reviews.list(a, query);
  }

  @Post(":reviewId/status")
  @HttpCode(204)
  @RequirePermission("content.manage")
  @Audit("review.moderated", { type: "review", param: "reviewId" })
  async status(@StoreAccess() a: StoreAccessContext, @Param("reviewId") id: string, @Body() body: unknown): Promise<void> {
    await this.reviews.setStatus(a, id, body);
  }

  @Post(":reviewId/reply")
  @HttpCode(204)
  @RequirePermission("content.manage")
  @Audit("review.replied", { type: "review", param: "reviewId" })
  async reply(@StoreAccess() a: StoreAccessContext, @Param("reviewId") id: string, @Body() body: unknown): Promise<void> {
    await this.reviews.reply(a, id, body);
  }
}
