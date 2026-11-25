import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Param, Patch, Post, Query, UseGuards, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { AuthedRequest } from "../../../auth/session.guard.js";
import { SessionGuard } from "../../../auth/session.guard.js";
import { CurrentUser } from "../../../http/current-user.js";
import type { SafeUser } from "../../../auth/ports.js";
import { PlatformService } from "../application/platform.service.js";
import { PlatformSettingsService } from "../application/settings.service.js";
import { PilotAccessService } from "../application/pilot.service.js";

/**
 * Platform operators only (phase 3.1, D31-1). Runs after SessionGuard and reads the role from the DATABASE on every request (a revoked
 * admin loses access at once; nothing about the role is in the session token). A signed-in user without the role gets 403.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<AuthedRequest>().sessionUser;
    if (!user || (await this.platform.roleOf(user.id)) !== "SUPER_ADMIN") throw new ForbiddenException();
    return true;
  }
}

/** `/api/platform/*` (v1: `/api/v1/platform/*`). Not routed by Caddy yet: reachable on the internal network only (docs/commerce.md). */
@Controller("platform")
@UseGuards(SessionGuard, PlatformAdminGuard)
export class PlatformController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(PilotAccessService) private readonly pilot: PilotAccessService,
  ) {}

  // ---- MVP item 2: invitation codes (invite-only registration) and admin-assisted account recovery ----

  @Get("invites")
  invites() {
    return this.pilot.invites();
  }

  /** The code and its sign-up link are returned ONCE; only a hash is stored. Audited. */
  @Post("invites")
  @HttpCode(201)
  createInvite(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    return this.pilot.createInvite(user.id, body);
  }

  @Post("invites/:id/revoke")
  @HttpCode(204)
  async revokeInvite(@CurrentUser() user: SafeUser, @Param("id") id: string): Promise<void> {
    await this.pilot.revokeInvite(user.id, id);
  }

  /** Looks a user up by username (for recovery). */
  @Get("users")
  findUser(@Query("username") username?: string) {
    return this.pilot.findUser(username);
  }

  /**
   * Roadmap §12.3: a single-use 24 h recovery link after the owner's identity was verified OUTSIDE the app. Requires the admin's own
   * password, a reason and the attestation; ends every session of the user. The link is returned ONCE. Audited with the reason.
   */
  @Post("users/:userId/recovery")
  @HttpCode(200)
  recover(@CurrentUser() user: SafeUser, @Param("userId") userId: string, @Body() body: unknown) {
    return this.pilot.recover(user, userId, body);
  }

  @Get("me")
  me(@CurrentUser() user: SafeUser) {
    return { userId: user.id, username: user.username, role: "SUPER_ADMIN" as const };
  }

  @Get("overview")
  overview() {
    return this.platform.overview();
  }

  @Get("stores")
  stores(@Query("before") before?: string, @Query("limit") limit?: string) {
    return this.platform.stores({ before, limit });
  }

  // ---- ADR 0003 (G2): platform store suspension (audited in the repository transaction) ----

  @Post("stores/:id/suspend")
  @HttpCode(204)
  async suspend(@CurrentUser() user: SafeUser, @Param("id") storeId: string, @Body() body: unknown): Promise<void> {
    await this.platform.suspend(user.id, storeId, body);
  }

  @Post("stores/:id/suspension/amend")
  @HttpCode(204)
  async amendSuspension(@CurrentUser() user: SafeUser, @Param("id") storeId: string, @Body() body: unknown): Promise<void> {
    await this.platform.amend(user.id, storeId, body);
  }

  @Post("stores/:id/restore")
  @HttpCode(204)
  async restore(@CurrentUser() user: SafeUser, @Param("id") storeId: string, @Body() body: unknown): Promise<void> {
    await this.platform.restore(user.id, storeId, body);
  }

  /** The whole suspension history of a store, with the internal notes (platform admins only). */
  @Get("stores/:id/suspensions")
  suspensions(@Param("id") storeId: string) {
    return this.platform.suspensions(storeId);
  }

  @Get("admins")
  admins() {
    return this.platform.admins();
  }

  @Post("admins")
  @HttpCode(201)
  grant(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    return this.platform.grant(user.id, body);
  }

  @Post("admins/:userId/revoke")
  @HttpCode(204)
  async revoke(@CurrentUser() user: SafeUser, @Param("userId") userId: string): Promise<void> {
    await this.platform.revoke(user.id, userId);
  }

  /** Settings (SMS, payment, AI) and the state of the platform secrets: names, hints and dates, never a value. */
  @Get("settings")
  viewSettings() {
    return this.settings.view();
  }

  @Patch("settings/:group")
  updateSettings(@CurrentUser() user: SafeUser, @Param("group") group: string, @Body() body: unknown) {
    return this.settings.update(user.id, group, body);
  }

  /** Write-only: sets a platform secret from the allowlist (e.g. the Kavenegar API key). */
  @Post("secrets/:name")
  @HttpCode(204)
  async setSecret(@CurrentUser() user: SafeUser, @Param("name") name: string, @Body() body: unknown): Promise<void> {
    await this.settings.setSecret(user.id, name, body);
  }

  @Post("secrets/:name/delete")
  @HttpCode(204)
  async removeSecret(@CurrentUser() user: SafeUser, @Param("name") name: string): Promise<void> {
    await this.settings.removeSecret(user.id, name);
  }
}

