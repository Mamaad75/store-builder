import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Param, Patch, Post, Query, UseGuards, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { AuthedRequest } from "../../../auth/session.guard.js";
import { SessionGuard } from "../../../auth/session.guard.js";
import { CurrentUser } from "../../../http/current-user.js";
import type { SafeUser } from "../../../auth/ports.js";
import { PlatformService } from "../application/platform.service.js";
import { PlatformSettingsService } from "../application/settings.service.js";

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
  ) {}

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
