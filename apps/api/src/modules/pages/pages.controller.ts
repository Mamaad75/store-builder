import { Body, Controller, Get, HttpCode, Param, Post, Patch, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard.js";
import { addSection, getPageEditor, listPages, moveSection, recoverPage, removeDormantSection, removeSection, setPageVisibility, updateSection } from "./service.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../access/access.api.js";

type Rev = { expectedRevision?: unknown };

/** The page editor of one store (owner-scoped; every write carries the page revision it was based on). */
@Controller("stores/:storeId/pages")
@UseGuards(SessionGuard, StoreAccessGuard)
export class PagesController {
  @Get()
  @RequirePermission("store.view")
  list(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string) {
    return listPages(a.ownerId, storeId);
  }

  @Get(":pageType")
  @RequirePermission("store.view")
  editor(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Param("pageType") pageType: string) {
    return getPageEditor(a.ownerId, storeId, pageType);
  }

  @Post(":pageType/sections")
  @HttpCode(200)
  @RequirePermission("pages.write")
  @Audit("page.section_added", { type: "page", param: "pageType" })
  add(@StoreAccess() a: StoreAccessContext, @Param("storeId") s: string, @Param("pageType") p: string, @Body() b: Rev & { type?: unknown }) {
    return addSection(a.ownerId, s, p, { type: b?.type }, b?.expectedRevision);
  }

  @Patch(":pageType/sections/:sectionId")
  @RequirePermission("pages.write")
  @Audit("page.section_updated", { type: "section", param: "sectionId" })
  update(@StoreAccess() a: StoreAccessContext, @Param("storeId") s: string, @Param("pageType") p: string, @Param("sectionId") id: string, @Body() b: Rev & { props?: unknown }) {
    return updateSection(a.ownerId, s, p, id, b?.props, b?.expectedRevision);
  }

  @Post(":pageType/sections/:sectionId/delete")
  @HttpCode(200)
  @RequirePermission("pages.write")
  @Audit("page.section_removed", { type: "section", param: "sectionId" })
  remove(@StoreAccess() a: StoreAccessContext, @Param("storeId") s: string, @Param("pageType") p: string, @Param("sectionId") id: string, @Body() b: Rev) {
    return removeSection(a.ownerId, s, p, id, b?.expectedRevision);
  }

  @Post(":pageType/sections/:sectionId/delete-dormant")
  @HttpCode(200)
  @RequirePermission("pages.write")
  @Audit("page.dormant_section_removed", { type: "section", param: "sectionId" })
  removeDormant(@StoreAccess() a: StoreAccessContext, @Param("storeId") s: string, @Param("pageType") p: string, @Param("sectionId") id: string, @Body() b: Rev) {
    return removeDormantSection(a.ownerId, s, p, id, b?.expectedRevision);
  }

  @Post(":pageType/sections/:sectionId/move")
  @HttpCode(200)
  @RequirePermission("pages.write")
  @Audit("page.section_moved", { type: "section", param: "sectionId" })
  move(@StoreAccess() a: StoreAccessContext, @Param("storeId") s: string, @Param("pageType") p: string, @Param("sectionId") id: string, @Body() b: Rev & { direction?: unknown }) {
    return moveSection(a.ownerId, s, p, id, b?.direction, b?.expectedRevision);
  }

  @Post(":pageType/visibility")
  @HttpCode(200)
  @RequirePermission("pages.write")
  @Audit("page.visibility_changed", { type: "page", param: "pageType" })
  visibility(@StoreAccess() a: StoreAccessContext, @Param("storeId") s: string, @Param("pageType") p: string, @Body() b: Rev & { visible?: unknown }) {
    return setPageVisibility(a.ownerId, s, p, b?.visible, b?.expectedRevision);
  }

  @Post(":pageType/recover")
  @HttpCode(200)
  @RequirePermission("pages.write")
  @Audit("page.recovered", { type: "page", param: "pageType" })
  recover(@StoreAccess() a: StoreAccessContext, @Param("storeId") s: string, @Param("pageType") p: string, @Body() b: Rev) {
    return recoverPage(a.ownerId, s, p, b?.expectedRevision);
  }
}
