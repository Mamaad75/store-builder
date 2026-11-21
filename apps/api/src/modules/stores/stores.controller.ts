import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard.js";
import type { SafeUser } from "../../auth/ports.js";
import { CurrentUser } from "../../http/current-user.js";
import { getDraftPreview } from "../storefront/service.js";
import { createStore, deleteStore, getOnboardingFacts, getStore, listActiveTemplates, listStores, updateBusinessCategory, updateStore } from "./service.js";
import { listSwitchableThemes, previewThemeSwitch, switchTheme } from "./theme-switch.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../access/access.api.js";

/** Stores of the signed-in owner. Every method is owner-scoped in the service; a missing and a foreign id are both 404. */
@Controller("stores")
@UseGuards(SessionGuard)
export class StoresController {
  @Get()
  list(@CurrentUser() user: SafeUser) {
    return listStores(user.id);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    return createStore(user.id, body);
  }

  @Get("templates")
  templates() {
    return listActiveTemplates();
  }

  @Get("onboarding")
  onboarding(@CurrentUser() user: SafeUser) {
    return getOnboardingFacts(user.id);
  }

  @Get(":storeId")
  @UseGuards(StoreAccessGuard)
  @RequirePermission("store.view")
  get(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string) {
    return getStore(a.ownerId, storeId);
  }

  @Patch(":storeId")
  @UseGuards(StoreAccessGuard)
  @RequirePermission("store.settings")
  @Audit("store.settings_updated")
  update(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Body() body: unknown) {
    return updateStore(a.ownerId, storeId, body);
  }

  @Patch(":storeId/business-category")
  @UseGuards(StoreAccessGuard)
  @RequirePermission("store.settings")
  @Audit("store.category_changed")
  businessCategory(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Body() body: unknown) {
    return updateBusinessCategory(a.ownerId, storeId, body);
  }

  @Post(":storeId/delete")
  @HttpCode(204)
  @UseGuards(StoreAccessGuard)
  @RequirePermission("store.delete")
  @Audit("store.deleted")
  async remove(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Body() body: { confirmName?: unknown } | undefined): Promise<void> {
    await deleteStore(a.ownerId, storeId, body?.confirmName);
  }

  @Get(":storeId/themes")
  @UseGuards(StoreAccessGuard)
  @RequirePermission("store.view")
  themes(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string) {
    return listSwitchableThemes(a.ownerId, storeId);
  }

  @Get(":storeId/themes/:key/report")
  @UseGuards(StoreAccessGuard)
  @RequirePermission("store.view")
  themeReport(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Param("key") key: string) {
    return previewThemeSwitch(a.ownerId, storeId, key);
  }

  @Post(":storeId/themes/switch")
  @HttpCode(200)
  @UseGuards(StoreAccessGuard)
  @RequirePermission("theme.switch")
  @Audit("store.theme_switched")
  switch(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Body() body: unknown) {
    return switchTheme(a.ownerId, storeId, body);
  }

  /** Owner-only draft preview data (read-only). `theme` renders a candidate theme without applying it. */
  @Get(":storeId/preview")
  @UseGuards(StoreAccessGuard)
  @RequirePermission("store.view")
  preview(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Query("theme") theme?: string) {
    return getDraftPreview(a.ownerId, storeId, theme === undefined ? {} : { candidateThemeKey: theme });
  }
}
