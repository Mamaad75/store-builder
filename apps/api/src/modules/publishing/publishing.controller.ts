import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard.js";
import { getPublishState, listVersions, publishStore, setLiveVersion, unpublishStore } from "./service.js";
import { claimSubdomain, getSubdomainState } from "./subdomain.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../access/access.api.js";

/** Publishing, versions and the subdomain of one store (owner-scoped). */
@Controller("stores/:storeId")
@UseGuards(SessionGuard, StoreAccessGuard)
export class PublishingController {
  @Get("publish")
  @RequirePermission("store.view")
  state(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string) {
    return getPublishState(a.ownerId, storeId);
  }

  @Post("publish")
  @HttpCode(200)
  @RequirePermission("publish")
  @Audit("store.published")
  publish(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Body() body: unknown) {
    return publishStore(a.ownerId, storeId, body);
  }

  @Post("unpublish")
  @HttpCode(204)
  @RequirePermission("publish")
  @Audit("store.unpublished")
  async unpublish(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string): Promise<void> {
    await unpublishStore(a.ownerId, storeId);
  }

  @Get("versions")
  @RequirePermission("store.view")
  versions(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string) {
    return listVersions(a.ownerId, storeId);
  }

  @Post("versions/live")
  @HttpCode(200)
  @RequirePermission("publish")
  @Audit("store.version_live")
  live(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Body() body: { versionNumber?: unknown; mode?: unknown } | undefined) {
    return setLiveVersion(a.ownerId, storeId, { versionNumber: body?.versionNumber, mode: body?.mode === "republish" ? "republish" : "rollback" });
  }

  @Get("subdomain")
  @RequirePermission("store.view")
  subdomain(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string) {
    return getSubdomainState(a.ownerId, storeId);
  }

  @Post("subdomain")
  @HttpCode(200)
  @RequirePermission("domain.manage")
  @Audit("store.subdomain_claimed")
  claim(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Body() body: { label?: unknown; confirmChange?: unknown } | undefined) {
    return claimSubdomain(a.ownerId, storeId, { label: body?.label, confirmChange: body?.confirmChange });
  }
}
