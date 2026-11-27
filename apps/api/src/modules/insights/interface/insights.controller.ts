import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { PLATFORM_AUDIT_ACTIONS } from "@store-builder/shared/modules/platform/insights";
import { SessionGuard } from "../../../auth/session.guard.js";
import { PlatformAdminGuard } from "../../platform/platform.api.js";
import { InsightsService } from "../application/insights.service.js";

/** Read-only views for super admins: `/api/platform/dashboard`, `accounts`, `stores/:id/detail` and `activity`. */
@Controller("platform")
@UseGuards(SessionGuard, PlatformAdminGuard)
export class InsightsController {
  constructor(@Inject(InsightsService) private readonly insights: InsightsService) {}

  @Get("dashboard")
  dashboard(@Query("days") days?: string) {
    return this.insights.dashboard(days);
  }

  @Get("accounts")
  accounts(@Query() query: unknown) {
    return this.insights.accounts(query);
  }

  @Get("accounts/:userId")
  account(@Param("userId") id: string) {
    return this.insights.account(id);
  }

  @Get("stores/:id/detail")
  store(@Param("id") id: string) {
    return this.insights.store(id);
  }

  @Get("activity")
  async activity(@Query() query: unknown) {
    const rows = await this.insights.activity(query);
    return rows.map((r) => ({ id: r.id, action: r.action, group: PLATFORM_AUDIT_ACTIONS[r.action]?.group ?? null, actor: r.actor, targetType: r.targetType, targetId: r.targetId, metadata: r.metadata, createdAt: r.createdAt }));
  }
}
