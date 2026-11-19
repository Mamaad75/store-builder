import * as api from "@/client/api";
import { ApiUnavailableError, UnauthenticatedError } from "@/client/http";
import { go, hardGo, refresh } from "@/client/nav";
import { UNAVAILABLE_ERROR } from "@/app/actions-auth";
import { ConflictError, DRAFT_BUSY_MESSAGE, DraftBusyError, NotFoundError, StoreLimitError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { ThemeSwitchBlockedError } from "@store-builder/shared/modules/stores/theme-switch-types";
import { appearanceUrl } from "@store-builder/shared/modules/pages/urls";

/**
 * Browser-side form handlers of the store screens (ADR 0001: no Server Actions). Pattern for every handler: (1) identity is the session
 * cookie, checked by the API; (2) the input is built from an explicit whitelist of form fields (never spread FormData); (3) the API's
 * owner-scoped service does the rest. A missing OR foreign store always navigates to the store's own URL, which answers 404.
 */
export interface StoreFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function toState(e: unknown, storeId = ""): StoreFormState {
  if (e instanceof UnauthenticatedError) {
    hardGo("/login");
    return {};
  }
  if (e instanceof ApiUnavailableError) return { error: UNAVAILABLE_ERROR };
  if (e instanceof NotFoundError) {
    go(`/dashboard/stores/${encodeURIComponent(storeId)}`);
    return {};
  }
  if (e instanceof ValidationError) return { error: "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: e.fieldErrors };
  if (e instanceof StoreLimitError) return { error: `حداکثر ${e.limit.toLocaleString("fa-IR")} فروشگاه می‌توانید بسازید.` };
  if (e instanceof ConflictError) return { error: "فروشگاه هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید." };
  if (e instanceof DraftBusyError) return { error: DRAFT_BUSY_MESSAGE };
  throw e;
}

export async function createStoreAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  let id: string;
  try {
    ({ id } = await api.createStore({ name: str(fd, "name"), templateKey: str(fd, "templateKey"), businessCategory: str(fd, "businessCategory") || undefined }));
  } catch (e) {
    return toState(e);
  }
  go(`/dashboard/stores/${id}`);
  return {};
}

export async function updateStoreAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  const storeId = str(fd, "storeId");
  try {
    await api.updateStore(storeId, {
      name: str(fd, "name"),
      primaryColor: str(fd, "primaryColor"),
      contact: { phone: str(fd, "phone"), email: str(fd, "email"), address: str(fd, "address") },
      social: { instagram: str(fd, "instagram"), telegram: str(fd, "telegram"), whatsapp: str(fd, "whatsapp") },
      description: str(fd, "description"),
    });
  } catch (e) {
    return toState(e, storeId);
  }
  refresh();
  return { success: "تغییرات ذخیره شد." };
}

/** Metadata only: no content change, no draft revision bump (see updateBusinessCategory). */
export async function updateBusinessCategoryAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  const storeId = str(fd, "storeId");
  try {
    const r = await api.updateBusinessCategory(storeId, { businessCategory: str(fd, "businessCategory"), expected: str(fd, "expected") });
    refresh();
    return { success: r.changed ? "دسته‌بندی ذخیره شد." : "تغییری وجود نداشت." };
  } catch (e) {
    return toState(e, storeId);
  }
}

/**
 * Draft-only theme switch. The page the owner confirmed on carries the draft revision its compatibility report was
 * computed from; a stale revision, a blocked report or an unavailable theme is refused without writing anything.
 */
export async function switchThemeAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  const storeId = str(fd, "storeId");
  let key: string;
  try {
    const r = await api.switchTheme(storeId, { targetKey: str(fd, "targetKey"), expectedDraftRevision: str(fd, "expectedDraftRevision") });
    key = r.theme.key;
  } catch (e) {
    if (e instanceof ThemeSwitchBlockedError) {
      return { error: "تغییر قالب انجام نشد: ابتدا مشکلات سازگاری فهرست‌شده را در قالب فعلی برطرف کنید. هیچ داده‌ای تغییر نکرد." };
    }
    if (e instanceof ValidationError) return { error: e.fieldErrors.targetKey?.[0] ?? "قالب انتخاب‌شده معتبر نیست.", fieldErrors: e.fieldErrors };
    if (e instanceof ConflictError) return { error: "پیش‌نویس پس از بررسی سازگاری تغییر کرده است. بررسی را دوباره انجام دهید." };
    return toState(e, storeId);
  }
  go(`${appearanceUrl(storeId)}?switched=${encodeURIComponent(key)}`);
  return {};
}

export async function deleteStoreAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  const storeId = str(fd, "storeId");
  try {
    await api.deleteStore(storeId, str(fd, "confirmName"));
  } catch (e) {
    return toState(e, storeId);
  }
  go("/dashboard");
  return {};
}
