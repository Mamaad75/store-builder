import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { SupportService } from "../application/support.service.js";
import { detail, ticket } from "./dto.js";

/**
 * The store's support requests to the platform. Owner and manager (`support.write`): they speak for the business. Writes are allowed while the store is
 * suspended on purpose (it is how a suspended merchant reaches support): see SUSPENDED_WRITE_PERMISSIONS.
 */
@Controller("stores/:storeId/tickets")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreTicketsController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Get()
  @RequirePermission("support.write")
  async list(@StoreAccess() a: StoreAccessContext) {
    return (await this.support.list(a)).map(ticket);
  }

  @Post()
  @RequirePermission("support.write")
  @Audit("ticket.opened")
  async open(@StoreAccess() a: StoreAccessContext, @Body() body: unknown) {
    return ticket(await this.support.open(a, body));
  }

  @Get(":ticketId")
  @RequirePermission("support.write")
  async get(@StoreAccess() a: StoreAccessContext, @Param("ticketId") id: string) {
    return detail(await this.support.get(a, id));
  }

  @Post(":ticketId/messages")
  @RequirePermission("support.write")
  @Audit("ticket.replied", { type: "ticket", param: "ticketId" })
  async reply(@StoreAccess() a: StoreAccessContext, @Param("ticketId") id: string, @Body() body: unknown) {
    return ticket(await this.support.reply(a, id, body));
  }

  @Post(":ticketId/close")
  @HttpCode(204)
  @RequirePermission("support.write")
  @Audit("ticket.closed", { type: "ticket", param: "ticketId" })
  async close(@StoreAccess() a: StoreAccessContext, @Param("ticketId") id: string): Promise<void> {
    await this.support.close(a, id);
  }
}
