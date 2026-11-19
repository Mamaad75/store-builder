import { releaseMediaBestEffort, attachProductImage, setStoreLogo, uploadMedia, type MediaView } from "./service.js";
import { setSectionImage } from "../pages/service.js";

/**
 * Upload + attach as ONE operation (previously sequenced by the web app's server actions). If the second step fails (the product was
 * deleted meanwhile, the page changed, ...), the uploaded image is released again instead of being kept orphaned.
 */
async function withRollback(ownerId: string, storeId: string, bytes: Buffer, attach: (mediaId: string) => Promise<void>): Promise<MediaView> {
  let mediaId: string | null = null;
  try {
    const media = await uploadMedia(ownerId, storeId, bytes);
    mediaId = media.id;
    await attach(media.id);
    return media;
  } catch (e) {
    if (mediaId) await releaseMediaBestEffort(ownerId, storeId, mediaId);
    throw e;
  }
}

export const uploadProductImage = (ownerId: string, storeId: string, productId: string, bytes: Buffer) =>
  withRollback(ownerId, storeId, bytes, (id) => attachProductImage(ownerId, storeId, productId, id));

export const uploadStoreLogo = (ownerId: string, storeId: string, bytes: Buffer) => withRollback(ownerId, storeId, bytes, (id) => setStoreLogo(ownerId, storeId, id));

export const uploadSectionImage = (ownerId: string, storeId: string, pageType: string, sectionId: string, expectedRevision: unknown, bytes: Buffer) =>
  withRollback(ownerId, storeId, bytes, async (id) => {
    await setSectionImage(ownerId, storeId, pageType, sectionId, id, expectedRevision);
  });
