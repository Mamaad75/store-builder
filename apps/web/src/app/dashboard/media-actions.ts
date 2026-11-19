import * as api from "@/client/api";
import { transportState } from "@/client/guard";
import { go, refresh } from "@/client/nav";
import { MEDIA_VALIDATION_MESSAGES, MediaQuotaError, MediaRateLimitError, MediaStorageError, MediaValidationError } from "@store-builder/shared/modules/media/errors";
import { MAX_MEDIA_BYTES_PER_STORE, MAX_MEDIA_PER_STORE, MAX_UPLOAD_BYTES } from "@store-builder/shared/modules/media/limits";
import { pageUrl } from "@store-builder/shared/modules/pages/urls";
import { productUrl, storeUrl } from "@store-builder/shared/modules/products/list-url";
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
 * Same pattern as every handler: (1) identity is the session cookie, checked by the API, (2) ids are only ever passed to
 * owner-scoped services (a forged store/product id is simply "not found"), (3) the client supplies nothing but the
 * file; the object key, MIME type, dimensions and owner are all decided on the server.
 */
function toState(e: unknown, notFoundUrl: string): MediaFormState {
  const transport = transportState(e);
  if (transport) return transport;
  if (e instanceof NotFoundError) {
    go(notFoundUrl);
    return {};
  }
  if (e instanceof DraftBusyError) return { error: DRAFT_BUSY_MESSAGE };
  if (e instanceof MediaValidationError) return { error: MEDIA_VALIDATION_MESSAGES[e.code] };
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
async function readFile(fd: FormData): Promise<File | MediaFormState> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "یک فایل تصویر انتخاب کنید." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "حجم فایل بیش از ۵ مگابایت است." };
  return file; // sent as raw bytes: the browser streams the File, nothing is buffered here
}

export async function uploadProductImageAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  const storeId = str(fd, "storeId");
  const productId = str(fd, "productId");
  const bytes = await readFile(fd);
  if (!(bytes instanceof File)) return bytes;
  try {
    await api.uploadProductImage(storeId, productId, bytes); // the API uploads, attaches and rolls the image back on failure
  } catch (e) {
    return toState(e, productUrl(storeId, productId));
  }
  refresh();
  return { success: "تصویر محصول ذخیره شد." };
}

export async function removeProductImageAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  const storeId = str(fd, "storeId");
  const productId = str(fd, "productId");
  try {
    await api.removeProductImage(storeId, productId);
  } catch (e) {
    return toState(e, productUrl(storeId, productId));
  }
  refresh();
  return { success: "تصویر محصول حذف شد." };
}

export async function uploadStoreLogoAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  const storeId = str(fd, "storeId");
  const bytes = await readFile(fd);
  if (!(bytes instanceof File)) return bytes;
  try {
    await api.uploadStoreLogo(storeId, bytes);
  } catch (e) {
    return toState(e, storeUrl(storeId));
  }
  refresh();
  return { success: "لوگوی فروشگاه ذخیره شد." };
}

export async function removeStoreLogoAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  const storeId = str(fd, "storeId");
  try {
    await api.removeStoreLogo(storeId);
  } catch (e) {
    return toState(e, storeUrl(storeId));
  }
  refresh();
  return { success: "لوگوی فروشگاه حذف شد." };
}

/** Section image (hero / image+text): same pipeline; the reference is validated against this store under the store lock. */
export async function uploadSectionImageAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  const storeId = str(fd, "storeId");
  const pageType = str(fd, "pageType");
  const sectionId = str(fd, "sectionId");
  const bytes = await readFile(fd);
  if (!(bytes instanceof File)) return bytes;
  try {
    await api.uploadSectionImage(storeId, pageType, sectionId, str(fd, "expectedRevision"), bytes);
  } catch (e) {
    if (e instanceof ConflictError) return { error: "این صفحه هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید." };
    if (e instanceof PageNeedsRecoveryError) return { error: "این صفحه بخش نامعتبر دارد؛ ابتدا آن را بازیابی کنید." };
    if (e instanceof ValidationError) return { error: "این بخش تصویر ندارد." };
    return toState(e, pageUrl(storeId, pageType));
  }
  refresh();
  return { success: "تصویر بخش ذخیره شد." };
}

export async function removeSectionImageAction(_prev: MediaFormState, fd: FormData): Promise<MediaFormState> {
  const storeId = str(fd, "storeId");
  const pageType = str(fd, "pageType");
  try {
    await api.removeSectionImage(storeId, pageType, str(fd, "sectionId"), str(fd, "expectedRevision"));
  } catch (e) {
    if (e instanceof ConflictError) return { error: "این صفحه هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید." };
    if (e instanceof PageNeedsRecoveryError) return { error: "این صفحه بخش نامعتبر دارد؛ ابتدا آن را بازیابی کنید." };
    return toState(e, pageUrl(storeId, pageType));
  }
  refresh();
  return { success: "تصویر بخش حذف شد." };
}
