"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { StorageConfigError } from "@/lib/storage/config";
import { requireUser } from "@/modules/auth/session";
import { MediaQuotaError, MediaRateLimitError, MediaStorageError, MediaValidationError } from "@/modules/media/errors";
import { MAX_MEDIA_BYTES_PER_STORE, MAX_MEDIA_PER_STORE, MAX_UPLOAD_BYTES } from "@/modules/media/limits";
import {
  attachProductImage,
  detachProductImage,
  releaseMedia,
  removeStoreLogo,
  setStoreLogo,
  uploadMedia,
} from "@/modules/media/service";
import { productUrl, productsUrl, storeUrl } from "@/modules/products/list-url";
import { NotFoundError } from "@/modules/stores/errors";

export interface MediaFormState {
  error?: string;
  success?: string;
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/**
 * Same pattern as every action: (1) identity from the server session only, (2) ids are only ever passed to
 * owner-scoped services (a forged store/product id is simply "not found"), (3) the client supplies nothing but the
 * file; the object key, MIME type, dimensions and owner are all decided on the server.
 */
function toState(e: unknown, notFoundUrl: string): MediaFormState {
  if (e instanceof NotFoundError) redirect(notFoundUrl);
  if (e instanceof MediaValidationError) return { error: e.message };
  if (e instanceof MediaQuotaError) {
    return {
      error:
        e.kind === "count"
          ? `حداکثر ${MAX_MEDIA_PER_STORE.toLocaleString("fa-IR")} تصویر در هر فروشگاه مجاز است.`
          : `حجم کل تصویرهای فروشگاه از ${(MAX_MEDIA_BYTES_PER_STORE / 1024 / 1024).toLocaleString("fa-IR")} مگابایت بیشتر می‌شود.`,
    };
  }
  if (e instanceof MediaRateLimitError) {
    return { error: `تعداد آپلودها بیش از حد مجاز است. ${Math.ceil(e.retryAfterSeconds / 60).toLocaleString("fa-IR")} دقیقه بعد دوباره تلاش کنید.` };
  }
  if (e instanceof MediaStorageError || e instanceof StorageConfigError) {
    return { error: "ذخیره‌سازی تصویر در حال حاضر ممکن نیست. بعداً دوباره تلاش کنید." };
  }
  throw e;
}

/** The file part of the form, read only after its declared size is checked (the real limits are enforced again by the pipeline). */
async function readFile(fd: FormData): Promise<Buffer | MediaFormState> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "یک فایل تصویر انتخاب کنید." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "حجم فایل بیش از ۵ مگابایت است." };
  return Buffer.from(await file.arrayBuffer());
}

export async function uploadProductImageAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  const productId = str(fd, "productId");
  const bytes = await readFile(fd);
  if (!Buffer.isBuffer(bytes)) return bytes;
  let mediaId: string | null = null;
  try {
    const media = await uploadMedia(user.id, storeId, bytes);
    mediaId = media.id;
    await attachProductImage(user.id, storeId, productId, media.id);
  } catch (e) {
    // The upload succeeded but the product could not be updated (e.g. it was deleted meanwhile): do not keep the image.
    if (mediaId) await releaseMedia(user.id, storeId, mediaId).catch(() => undefined);
    return toState(e, productUrl(storeId, productId));
  }
  revalidatePath(productUrl(storeId, productId));
  revalidatePath(productsUrl(storeId));
  return { success: "تصویر محصول ذخیره شد." };
}

export async function removeProductImageAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  const productId = str(fd, "productId");
  try {
    await detachProductImage(user.id, storeId, productId);
  } catch (e) {
    return toState(e, productUrl(storeId, productId));
  }
  revalidatePath(productUrl(storeId, productId));
  return { success: "تصویر محصول حذف شد." };
}

export async function uploadStoreLogoAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  const bytes = await readFile(fd);
  if (!Buffer.isBuffer(bytes)) return bytes;
  let mediaId: string | null = null;
  try {
    const media = await uploadMedia(user.id, storeId, bytes);
    mediaId = media.id;
    await setStoreLogo(user.id, storeId, media.id);
  } catch (e) {
    if (mediaId) await releaseMedia(user.id, storeId, mediaId).catch(() => undefined);
    return toState(e, storeUrl(storeId));
  }
  revalidatePath(storeUrl(storeId));
  return { success: "لوگوی فروشگاه ذخیره شد." };
}

export async function removeStoreLogoAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  try {
    await removeStoreLogo(user.id, storeId);
  } catch (e) {
    return toState(e, storeUrl(storeId));
  }
  revalidatePath(storeUrl(storeId));
  return { success: "لوگوی فروشگاه حذف شد." };
}
