"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/modules/auth/session";
import { ConflictError, NotFoundError, StoreLimitError, ValidationError } from "@/modules/stores/errors";
import { createStore, deleteStore, updateBusinessCategory, updateStore } from "@/modules/stores/service";

export interface StoreFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/**
 * Pattern for every action: (1) identity from the server session only, (2) build the input from an
 * explicit whitelist of form fields (never spread FormData), (3) delegate to the service, which
 * enforces ownership. NotFoundError (missing OR not yours) always becomes the same 404.
 */
function toState(e: unknown, storeId = ""): StoreFormState {
  // A Server Action's notFound() is not rendered as a 404 page, so send the browser to the store's
  // URL, which answers with a real 404 that is identical for foreign and non-existent ids.
  if (e instanceof NotFoundError) redirect(`/dashboard/stores/${encodeURIComponent(storeId)}`);
  if (e instanceof ValidationError) return { error: "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: e.fieldErrors };
  if (e instanceof StoreLimitError) return { error: `حداکثر ${e.limit.toLocaleString("fa-IR")} فروشگاه می‌توانید بسازید.` };
  if (e instanceof ConflictError) return { error: "فروشگاه هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید." };
  throw e;
}

export async function createStoreAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  const user = await requireUser();
  let id: string;
  try {
    ({ id } = await createStore(user.id, { name: str(fd, "name"), templateKey: str(fd, "templateKey"), businessCategory: str(fd, "businessCategory") || undefined }));
  } catch (e) {
    return toState(e);
  }
  revalidatePath("/dashboard");
  redirect(`/dashboard/stores/${id}`);
}

export async function updateStoreAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  try {
    await updateStore(user.id, storeId, {
      name: str(fd, "name"),
      primaryColor: str(fd, "primaryColor"),
      contact: { phone: str(fd, "phone"), email: str(fd, "email"), address: str(fd, "address") },
      social: { instagram: str(fd, "instagram"), telegram: str(fd, "telegram"), whatsapp: str(fd, "whatsapp") },
    });
  } catch (e) {
    return toState(e, storeId);
  }
  revalidatePath("/dashboard");
  return { success: "تغییرات ذخیره شد." };
}

/** Metadata only: no content change, no draft revision bump (see updateBusinessCategory). */
export async function updateBusinessCategoryAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  try {
    const r = await updateBusinessCategory(user.id, storeId, { businessCategory: str(fd, "businessCategory"), expected: str(fd, "expected") });
    revalidatePath(`/dashboard/stores/${encodeURIComponent(storeId)}`);
    return { success: r.changed ? "دسته‌بندی ذخیره شد." : "تغییری وجود نداشت." };
  } catch (e) {
    return toState(e, storeId);
  }
}

export async function deleteStoreAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  try {
    await deleteStore(user.id, storeId, str(fd, "confirmName"));
  } catch (e) {
    return toState(e, storeId);
  }
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
