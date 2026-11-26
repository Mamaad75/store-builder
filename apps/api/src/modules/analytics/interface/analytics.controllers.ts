import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { SessionGuard } from "../../../auth/session.guard.js";
import { RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { AnalyticsService } from "../application/analytics.service.js";
import { VisitService } from "../application/visit.service.js";

/**
 * The storefront's page-view beacon: `POST /api/public/stores/:label/visit` (the browser calls `/api/shop/visit` on the store's own
 * host). Always answers 204 with nothing in the body, whatever happened, so it reveals nothing about stores or limits.
 */
@Controller("public/stores/:label/visit")
export class PublicVisitController {
  constructor(@Inject(VisitService) private readonly visits: VisitService) {}

  @Post()
  @HttpCode(204)
  async visit(@Param("label") label: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    const ua = req.headers["user-agent"];
    try {
      await this.visits.record(label, { ip: req.ip ?? "unknown", userAgent: typeof ua === "string" ? ua : "", doNotTrack: req.headers.dnt === "1" || req.headers["sec-gpc"] === "1" });
    } catch {
      // A counter must never break a page: the failure is not shown to the shopper.
    }
  }
}

/**
 * The merchant's trend charts. Read-only; `orders.view` (owner and manager: the figures include order values). Allowed while suspended (GET).
 */
@Controller("stores/:storeId/analytics")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreAnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Get()
  @RequirePermission("orders.view")
  report(@StoreAccess() a: StoreAccessContext, @Query("days") days?: string) {
    return this.analytics.report(a, days);
  }
}
