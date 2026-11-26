import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import type { SafeUser } from "../../../auth/ports.js";
import { CurrentUser } from "../../../http/current-user.js";
import { PlatformAdminGuard } from "../../platform/platform.api.js";
import { StaffSupportService } from "../application/support.service.js";
import { detail, ticket } from "./dto.js";

/** `/api/platform/tickets/*`: the platform staff's inbox over every store's requests. */
@Controller("platform/tickets")
@UseGuards(SessionGuard, PlatformAdminGuard)
export class PlatformTicketsController {
  constructor(@Inject(StaffSupportService) private readonly staff: StaffSupportService) {}

  @Get()
  async list(@Query() query: unknown) {
    return (await this.staff.list(query)).map((t) => ({ ...ticket(t), storeId: t.storeId, storeName: t.storeName }));
  }

  @Get(":ticketId")
  async get(@Param("ticketId") id: string) {
    const d = await this.staff.get(id);
    return { ...detail(d), storeId: d.ticket.storeId, storeName: d.ticket.storeName };
  }

  @Post(":ticketId/messages")
  async reply(@CurrentUser() user: SafeUser, @Param("ticketId") id: string, @Body() body: unknown) {
    return ticket(await this.staff.reply(user.id, id, body));
  }

  @Post(":ticketId/status")
  @HttpCode(204)
  async status(@CurrentUser() user: SafeUser, @Param("ticketId") id: string, @Body() body: unknown): Promise<void> {
    await this.staff.setStatus(user.id, id, body);
  }
}
