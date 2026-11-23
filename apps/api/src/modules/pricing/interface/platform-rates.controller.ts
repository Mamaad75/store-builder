import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { CurrentUser } from "../../../http/current-user.js";
import type { SafeUser } from "../../../auth/ports.js";
import { PlatformAdminGuard } from "../../platform/platform.api.js";
import { RatesService } from "../application/rates.service.js";

/** Rates for super admins (phase 3.2b): view, enter by hand, confirm or reject a held jump. Every decision is audited. */
@Controller("platform/rates")
@UseGuards(SessionGuard, PlatformAdminGuard)
export class PlatformRatesController {
  constructor(@Inject(RatesService) private readonly rates: RatesService) {}

  @Get()
  overview() {
    return this.rates.overview();
  }

  @Post()
  @HttpCode(201)
  enter(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    return this.rates.enterManual(user.id, body);
  }

  @Post(":rateId/confirm")
  @HttpCode(204)
  async confirm(@CurrentUser() user: SafeUser, @Param("rateId") rateId: string): Promise<void> {
    await this.rates.decide(user.id, rateId, "APPLIED");
  }

  @Post(":rateId/reject")
  @HttpCode(204)
  async reject(@CurrentUser() user: SafeUser, @Param("rateId") rateId: string): Promise<void> {
    await this.rates.decide(user.id, rateId, "REJECTED");
  }
}
