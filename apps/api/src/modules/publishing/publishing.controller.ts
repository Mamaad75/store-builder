import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard.js";
import type { SafeUser } from "../../auth/ports.js";
import { CurrentUser } from "../../http/current-user.js";
import { getPublishState, listVersions, publishStore, setLiveVersion, unpublishStore } from "./service.js";
import { claimSubdomain, getSubdomainState } from "./subdomain.js";

/** Publishing, versions and the subdomain of one store (owner-scoped). */
@Controller("stores/:storeId")
@UseGuards(SessionGuard)
export class PublishingController {
  @Get("publish")
  state(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string) {
    return getPublishState(user.id, storeId);
  }

  @Post("publish")
  @HttpCode(200)
  publish(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Body() body: unknown) {
    return publishStore(user.id, storeId, body);
  }

  @Post("unpublish")
  @HttpCode(204)
  async unpublish(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string): Promise<void> {
    await unpublishStore(user.id, storeId);
  }

  @Get("versions")
  versions(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string) {
    return listVersions(user.id, storeId);
  }

  @Post("versions/live")
  @HttpCode(200)
  live(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Body() body: { versionNumber?: unknown; mode?: unknown } | undefined) {
    return setLiveVersion(user.id, storeId, { versionNumber: body?.versionNumber, mode: body?.mode === "republish" ? "republish" : "rollback" });
  }

  @Get("subdomain")
  subdomain(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string) {
    return getSubdomainState(user.id, storeId);
  }

  @Post("subdomain")
  @HttpCode(200)
  claim(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Body() body: { label?: unknown; confirmChange?: unknown } | undefined) {
    return claimSubdomain(user.id, storeId, { label: body?.label, confirmChange: body?.confirmChange });
  }
}
