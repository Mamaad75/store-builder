"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import { MediaQuotaError, MediaRateLimitError, MediaStorageError, MediaValidationError } from "@store-builder/shared/modules/media/errors";
import { MAX_MEDIA_BYTES_PER_STORE, MAX_MEDIA_PER_STORE, MAX_UPLOAD_BYTES } from "@store-builder/shared/modules/media/limits";
import { removeProductImage, removeSectionImage, removeStoreLogo, uploadProductImage, uploadSectionImage, uploadStoreLogo } from "@/gateway/media";
import { pageUrl } from "@store-builder/shared/modules/pages/urls";
import { productUrl, productsUrl, storeUrl } from "@store-builder/shared/modules/products/list-url";
import { PageNeedsRecoveryError } from "@store-builder/shared/modules/pages/errors";
import { ConflictError, DRAFT_BUSY_MESSAGE, DraftBusyError, NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";

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
  if (e instanceof DraftBusyError) return { error: DRAFT_BUSY_MESSAGE };
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
  if (e instanceof MediaStorageError) {
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
  await requireUser();
  const storeId = str(fd, "storeId");
  const productId = str(fd, "productId");
  const bytes = await readFile(fd);
  if (!Buffer.isBuffer(bytes)) return bytes;
  try {
    await uploadProductImage(storeId, productId, bytes); // the API uploads, attaches and rolls the image back on failure
  } catch (e) {
    return toState(e, productUrl(storeId, productId));
  }
  revalidatePath(productUrl(storeId, productId));
  revalidatePath(productsUrl(storeId));
  return { success: "تصویر محصول ذخیره شد." };
}

export async function removeProductImageAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  await requireUser();
  const storeId = str(fd, "storeId");
  const productId = str(fd, "productId");
  try {
    await removeProductImage(storeId, productId);
  } catch (e) {
    return toState(e, productUrl(storeId, productId));
  }
  revalidatePath(productUrl(storeId, productId));
  return { success: "تصویر محصول حذف شد." };
}

export async function uploadStoreLogoAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  await requireUser();
  const storeId = str(fd, "storeId");
  const bytes = await readFile(fd);
  if (!Buffer.isBuffer(bytes)) return bytes;
  try {
    await uploadStoreLogo(storeId, bytes);
  } catch (e) {
    return toState(e, storeUrl(storeId));
  }
  revalidatePath(storeUrl(storeId));
  return { success: "لوگوی فروشگاه ذخیره شد." };
}

export async function removeStoreLogoAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  await requireUser();
  const storeId = str(fd, "storeId");
  try {
    await removeStoreLogo(storeId);
  } catch (e) {
    return toState(e, storeUrl(storeId));
  }
  revalidatePath(storeUrl(storeId));
  return { success: "لوگوی فروشگاه حذف شد." };
}

/** Section image (hero / image+text): same pipeline; the reference is validated against this store under the store lock. */
export async function uploadSectionImageAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  await requireUser();
  const storeId = str(fd, "storeId");
  const pageType = str(fd, "pageType");
  const sectionId = str(fd, "sectionId");
  const bytes = await readFile(fd);
  if (!Buffer.isBuffer(bytes)) return bytes;
  try {
    await uploadSectionImage(storeId, pageType, sectionId, str(fd, "expectedRevision"), bytes);
  } catch (e) {
    if (e instanceof ConflictError) return { error: "این صفحه هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید." };
    if (e instanceof PageNeedsRecoveryError) return { error: "این صفحه بخش نامعتبر دارد؛ ابتدا آن را بازیابی کنید." };
    if (e instanceof ValidationError) return { error: "این بخش تصویر ندارد." };
    return toState(e, pageUrl(storeId, pageType));
  }
  revalidatePath(pageUrl(storeId, pageType));
  return { success: "تصویر بخش ذخیره شد." };
}

export async function removeSectionImageAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  await requireUser();
  const storeId = str(fd, "storeId");
  const pageType = str(fd, "pageType");
  try {
    await removeSectionImage(storeId, pageType, str(fd, "sectionId"), str(fd, "expectedRevision"));
  } catch (e) {
    if (e instanceof ConflictError) return { error: "این صفحه هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید." };
    if (e instanceof PageNeedsRecoveryError) return { error: "این صفحه بخش نامعتبر دارد؛ ابتدا آن را بازیابی کنید." };
    return toState(e, pageUrl(storeId, pageType));
  }
  revalidatePath(pageUrl(storeId, pageType));
  return { success: "تصویر بخش حذف شد." };
}
