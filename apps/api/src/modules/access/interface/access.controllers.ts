import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { SafeUser } from "../../../auth/ports.js";
import { SessionGuard } from "../../../auth/session.guard.js";
import { CurrentUser } from "../../../http/current-user.js";
import { AccessService } from "../application/access.service.js";
import type { StoreAccessContext } from "../application/ports.js";
import { RequirePermission, StoreAccess, StoreAccessGuard } from "./store-access.js";

/** Staff of one store (owner only: members.manage). Changes are audited inside the service with the real actor. */
@Controller("stores/:storeId/team")
@UseGuards(SessionGuard, StoreAccessGuard)
export class TeamController {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  @Get()
  @RequirePermission("members.manage")
  team(@StoreAccess() a: StoreAccessContext) {
    return this.access.team(a);
  }

  @Post("invitations")
  @HttpCode(201)
  @RequirePermission("members.manage")
  invite(@StoreAccess() a: StoreAccessContext, @Body() body: unknown) {
    return this.access.invite(a, body);
  }

  @Post("invitations/:invitationId/cancel")
  @HttpCode(204)
  @RequirePermission("members.manage")
  async cancel(@StoreAccess() a: StoreAccessContext, @Param("invitationId") id: string): Promise<void> {
    await this.access.cancelInvitation(a, id);
  }

  @Patch("members/:userId")
  @HttpCode(204)
  @RequirePermission("members.manage")
  async role(@StoreAccess() a: StoreAccessContext, @Param("userId") userId: string, @Body() body: unknown): Promise<void> {
    await this.access.changeRole(a, userId, body);
  }

  @Post("members/:userId/remove")
  @HttpCode(204)
  @RequirePermission("members.manage")
  async remove(@StoreAccess() a: StoreAccessContext, @Param("userId") userId: string): Promise<void> {
    await this.access.removeMember(a, userId);
  }
}

/** What the signed-in user may do in this store (any member: store.view). Lets the dashboard show only the pages a role can use. */
@Controller("stores/:storeId/access")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreAccessInfoController {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  @Get()
  @RequirePermission("store.view")
  mine(@StoreAccess() a: StoreAccessContext) {
    return this.access.mine(a);
  }
}

/** The store's audit log (owner and manager: audit.view), newest first, cursor = `before`. */
@Controller("stores/:storeId/audit")
@UseGuards(SessionGuard, StoreAccessGuard)
export class AuditController {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  @Get()
  @RequirePermission("audit.view")
  list(@StoreAccess() a: StoreAccessContext, @Query("before") before?: string, @Query("limit") limit?: string) {
    return this.access.auditLog(a, { before, limit });
  }
}

/** The signed-in user's own invitations and memberships (no store permission: every query is bound to the session user). */
@Controller("me")
@UseGuards(SessionGuard)
export class MyAccessController {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  @Get("invitations")
  invitations(@CurrentUser() user: SafeUser) {
    return this.access.myInvitations(user.id);
  }

  @Post("invitations/:invitationId/accept")
  @HttpCode(200)
  accept(@CurrentUser() user: SafeUser, @Param("invitationId") id: string) {
    return this.access.acceptInvitation(user.id, id);
  }

  @Post("invitations/:invitationId/decline")
  @HttpCode(204)
  async decline(@CurrentUser() user: SafeUser, @Param("invitationId") id: string): Promise<void> {
    await this.access.declineInvitation(user.id, id);
  }

  @Get("shared-stores")
  shared(@CurrentUser() user: SafeUser) {
    return this.access.sharedStores(user.id);
  }

  @Post("memberships/:membershipStoreId/leave")
  @HttpCode(204)
  async leave(@CurrentUser() user: SafeUser, @Param("membershipStoreId") storeId: string): Promise<void> {
    await this.access.leave(user.id, storeId);
  }
}
