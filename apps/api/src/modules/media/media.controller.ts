import { BadRequestException, Body, Controller, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../../auth/session.guard.js";
import { setSectionImage } from "../pages/service.js";
import { uploadProductImage, uploadSectionImage, uploadStoreLogo } from "./orchestration.js";
import { detachProductImage, removeStoreLogo } from "./service.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../access/access.api.js";

/** The image bytes of an upload: the raw request body (`application/octet-stream`, size-limited in app.ts). */
function imageBytes(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new BadRequestException();
  return req.body;
}

/** Image uploads: the client supplies only the bytes; key, type, dimensions and owner are decided on the server. */
@Controller("stores/:storeId")
@UseGuards(SessionGuard, StoreAccessGuard)
export class MediaController {
  @Post("products/:productId/image")
  @HttpCode(200)
  @RequirePermission("media.write")
  @Audit("product.image_set", { type: "product", param: "productId" })
  async productImage(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Param("productId") productId: string, @Req() req: Request) {
    return uploadProductImage(a.ownerId, storeId, productId, imageBytes(req));
  }

  @Post("products/:productId/image/delete")
  @HttpCode(204)
  @RequirePermission("media.write")
  @Audit("product.image_removed", { type: "product", param: "productId" })
  async removeProductImage(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Param("productId") productId: string): Promise<void> {
    await detachProductImage(a.ownerId, storeId, productId);
  }

  @Post("logo")
  @HttpCode(200)
  @RequirePermission("store.settings")
  @Audit("store.logo_set")
  async logo(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Req() req: Request) {
    return uploadStoreLogo(a.ownerId, storeId, imageBytes(req));
  }

  @Post("logo/delete")
  @HttpCode(204)
  @RequirePermission("store.settings")
  @Audit("store.logo_removed")
  async removeLogo(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string): Promise<void> {
    await removeStoreLogo(a.ownerId, storeId);
  }

  @Post("pages/:pageType/sections/:sectionId/image")
  @HttpCode(200)
  @RequirePermission("pages.write")
  @Audit("page.section_image_set", { type: "section", param: "sectionId" })
  async sectionImage(
    @StoreAccess() a: StoreAccessContext,
    @Param("storeId") storeId: string,
    @Param("pageType") pageType: string,
    @Param("sectionId") sectionId: string,
    @Query("expectedRevision") expectedRevision: string | undefined,
    @Req() req: Request,
  ) {
    return uploadSectionImage(a.ownerId, storeId, pageType, sectionId, expectedRevision, imageBytes(req));
  }

  @Post("pages/:pageType/sections/:sectionId/image/delete")
  @HttpCode(200)
  @RequirePermission("pages.write")
  @Audit("page.section_image_removed", { type: "section", param: "sectionId" })
  removeSectionImage(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Param("pageType") pageType: string, @Param("sectionId") sectionId: string, @Body() body: { expectedRevision?: unknown } | undefined) {
    return setSectionImage(a.ownerId, storeId, pageType, sectionId, null, body?.expectedRevision);
  }
}
