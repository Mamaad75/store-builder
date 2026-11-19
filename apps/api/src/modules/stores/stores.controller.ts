import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard.js";
import type { SafeUser } from "../../auth/ports.js";
import { CurrentUser } from "../../http/current-user.js";
import { getDraftPreview } from "../storefront/service.js";
import { createStore, deleteStore, getOnboardingFacts, getStore, listActiveTemplates, listStores, updateBusinessCategory, updateStore } from "./service.js";
import { listSwitchableThemes, previewThemeSwitch, switchTheme } from "./theme-switch.js";

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
  get(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string) {
    return getStore(user.id, storeId);
  }

  @Patch(":storeId")
  update(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Body() body: unknown) {
    return updateStore(user.id, storeId, body);
  }

  @Patch(":storeId/business-category")
  businessCategory(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Body() body: unknown) {
    return updateBusinessCategory(user.id, storeId, body);
  }

  @Post(":storeId/delete")
  @HttpCode(204)
  async remove(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Body() body: { confirmName?: unknown } | undefined): Promise<void> {
    await deleteStore(user.id, storeId, body?.confirmName);
  }

  @Get(":storeId/themes")
  themes(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string) {
    return listSwitchableThemes(user.id, storeId);
  }

  @Get(":storeId/themes/:key/report")
  themeReport(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("key") key: string) {
    return previewThemeSwitch(user.id, storeId, key);
  }

  @Post(":storeId/themes/switch")
  @HttpCode(200)
  switch(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Body() body: unknown) {
    return switchTheme(user.id, storeId, body);
  }

  /** Owner-only draft preview data (read-only). `theme` renders a candidate theme without applying it. */
  @Get(":storeId/preview")
  preview(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Query("theme") theme?: string) {
    return getDraftPreview(user.id, storeId, theme === undefined ? {} : { candidateThemeKey: theme });
  }
}
