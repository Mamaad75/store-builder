import { BadRequestException, Body, Controller, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../../auth/session.guard.js";
import type { SafeUser } from "../../auth/ports.js";
import { CurrentUser } from "../../http/current-user.js";
import { setSectionImage } from "../pages/service.js";
import { uploadProductImage, uploadSectionImage, uploadStoreLogo } from "./orchestration.js";
import { detachProductImage, removeStoreLogo } from "./service.js";

/** The image bytes of an upload: the raw request body (`application/octet-stream`, size-limited in app.ts). */
function imageBytes(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new BadRequestException();
  return req.body;
}

/** Image uploads: the client supplies only the bytes; key, type, dimensions and owner are decided on the server. */
@Controller("stores/:storeId")
@UseGuards(SessionGuard)
export class MediaController {
  @Post("products/:productId/image")
  @HttpCode(200)
  async productImage(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("productId") productId: string, @Req() req: Request) {
    return uploadProductImage(user.id, storeId, productId, imageBytes(req));
  }

  @Post("products/:productId/image/delete")
  @HttpCode(204)
  async removeProductImage(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("productId") productId: string): Promise<void> {
    await detachProductImage(user.id, storeId, productId);
  }

  @Post("logo")
  @HttpCode(200)
  async logo(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Req() req: Request) {
    return uploadStoreLogo(user.id, storeId, imageBytes(req));
  }

  @Post("logo/delete")
  @HttpCode(204)
  async removeLogo(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string): Promise<void> {
    await removeStoreLogo(user.id, storeId);
  }

  @Post("pages/:pageType/sections/:sectionId/image")
  @HttpCode(200)
  async sectionImage(
    @CurrentUser() user: SafeUser,
    @Param("storeId") storeId: string,
    @Param("pageType") pageType: string,
    @Param("sectionId") sectionId: string,
    @Query("expectedRevision") expectedRevision: string | undefined,
    @Req() req: Request,
  ) {
    return uploadSectionImage(user.id, storeId, pageType, sectionId, expectedRevision, imageBytes(req));
  }

  @Post("pages/:pageType/sections/:sectionId/image/delete")
  @HttpCode(200)
  removeSectionImage(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("pageType") pageType: string, @Param("sectionId") sectionId: string, @Body() body: { expectedRevision?: unknown } | undefined) {
    return setSectionImage(user.id, storeId, pageType, sectionId, null, body?.expectedRevision);
  }
}
