import { Body, Controller, Get, HttpCode, Param, Post, Patch, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard.js";
import type { SafeUser } from "../../auth/ports.js";
import { CurrentUser } from "../../http/current-user.js";
import { addSection, getPageEditor, listPages, moveSection, recoverPage, removeDormantSection, removeSection, setPageVisibility, updateSection } from "./service.js";

type Rev = { expectedRevision?: unknown };

/** The page editor of one store (owner-scoped; every write carries the page revision it was based on). */
@Controller("stores/:storeId/pages")
@UseGuards(SessionGuard)
export class PagesController {
  @Get()
  list(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string) {
    return listPages(user.id, storeId);
  }

  @Get(":pageType")
  editor(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("pageType") pageType: string) {
    return getPageEditor(user.id, storeId, pageType);
  }

  @Post(":pageType/sections")
  @HttpCode(200)
  add(@CurrentUser() user: SafeUser, @Param("storeId") s: string, @Param("pageType") p: string, @Body() b: Rev & { type?: unknown }) {
    return addSection(user.id, s, p, { type: b?.type }, b?.expectedRevision);
  }

  @Patch(":pageType/sections/:sectionId")
  update(@CurrentUser() user: SafeUser, @Param("storeId") s: string, @Param("pageType") p: string, @Param("sectionId") id: string, @Body() b: Rev & { props?: unknown }) {
    return updateSection(user.id, s, p, id, b?.props, b?.expectedRevision);
  }

  @Post(":pageType/sections/:sectionId/delete")
  @HttpCode(200)
  remove(@CurrentUser() user: SafeUser, @Param("storeId") s: string, @Param("pageType") p: string, @Param("sectionId") id: string, @Body() b: Rev) {
    return removeSection(user.id, s, p, id, b?.expectedRevision);
  }

  @Post(":pageType/sections/:sectionId/delete-dormant")
  @HttpCode(200)
  removeDormant(@CurrentUser() user: SafeUser, @Param("storeId") s: string, @Param("pageType") p: string, @Param("sectionId") id: string, @Body() b: Rev) {
    return removeDormantSection(user.id, s, p, id, b?.expectedRevision);
  }

  @Post(":pageType/sections/:sectionId/move")
  @HttpCode(200)
  move(@CurrentUser() user: SafeUser, @Param("storeId") s: string, @Param("pageType") p: string, @Param("sectionId") id: string, @Body() b: Rev & { direction?: unknown }) {
    return moveSection(user.id, s, p, id, b?.direction, b?.expectedRevision);
  }

  @Post(":pageType/visibility")
  @HttpCode(200)
  visibility(@CurrentUser() user: SafeUser, @Param("storeId") s: string, @Param("pageType") p: string, @Body() b: Rev & { visible?: unknown }) {
    return setPageVisibility(user.id, s, p, b?.visible, b?.expectedRevision);
  }

  @Post(":pageType/recover")
  @HttpCode(200)
  recover(@CurrentUser() user: SafeUser, @Param("storeId") s: string, @Param("pageType") p: string, @Body() b: Rev) {
    return recoverPage(user.id, s, p, b?.expectedRevision);
  }
}
