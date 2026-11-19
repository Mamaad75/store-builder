import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { loadPublishedSnapshot, resolveLiveStore, resolveProductRedirect } from "../publishing/public-read.js";

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Read-only public endpoints for rendering published stores (no session). They read only published data (Domain, the Store pointer,
 * StoreVersion): the same functions the storefront always used. Every unavailable case is the same 404.
 */
@Controller("public/stores")
export class PublicStoresController {
  @Get(":label")
  async store(@Param("label") label: string) {
    if (!LABEL_RE.test(label)) throw new NotFoundException();
    const live = await resolveLiveStore(label);
    if (!live) throw new NotFoundException();
    const data = await loadPublishedSnapshot(live.versionId);
    if (!data) throw new NotFoundException();
    return { live, data };
  }

  @Get(":label/product-redirect")
  async redirect(@Param("label") label: string, @Query("slug") slug?: string) {
    if (!LABEL_RE.test(label) || typeof slug !== "string" || slug.length === 0 || slug.length > 200) throw new NotFoundException();
    const to = await resolveProductRedirect(label, slug);
    if (!to) throw new NotFoundException();
    return { to };
  }
}
