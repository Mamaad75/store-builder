"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import { PageNeedsRecoveryError, SectionLimitError, UnsupportedTemplateError } from "@/modules/pages/errors";
import { appearanceUrl, pagesUrl } from "@/modules/pages/urls";
import { addSection, getPageEditor, moveSection, recoverPage, removeDormantSection, removeSection, setPageVisibility, updateSection } from "@/modules/pages/service";
import { ConflictError, NotFoundError, ValidationError } from "@/modules/stores/errors";
import { updateStore } from "@/modules/stores/service";
import { propsFromFields } from "@/templates/section-fields";
import { getSectionDefinition } from "@/templates/section-registry";

export interface EditorState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
  /** The section the field errors belong to. */
  sectionId?: string;
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/**
 * Same pattern as every action: identity from the session only; input read from an explicit whitelist of form fields;
 * the owner-scoped service does the rest. A missing, foreign or unknown store/page is the same redirect to a 404.
 */
function toState(e: unknown, notFoundUrl: string, sectionId?: string): EditorState {
  if (e instanceof NotFoundError) redirect(notFoundUrl);
  if (e instanceof ValidationError) {
    const first = Object.values(e.fieldErrors).flat()[0];
    return { error: first ?? "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: e.fieldErrors, sectionId };
  }
  if (e instanceof ConflictError) return { error: "این صفحه هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید." };
  if (e instanceof PageNeedsRecoveryError) {
    return { error: `این صفحه ${e.invalidCount.toLocaleString("fa-IR")} بخش نامعتبر دارد. ابتدا «انتقال به بایگانی» را اجرا کنید؛ هیچ داده‌ای حذف نمی‌شود.` };
  }
  if (e instanceof SectionLimitError) return { error: `حداکثر ${e.limit.toLocaleString("fa-IR")} بخش در هر صفحه مجاز است.` };
  if (e instanceof UnsupportedTemplateError) return { error: "قالب این فروشگاه هنوز قابل ویرایش نیست." };
  throw e;
}

/** One action for every editor button; `intent` selects a whitelisted operation. All of them are draft-only. */
export async function pageEditAction(_prev: EditorState, fd: FormData): Promise<EditorState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  const pageType = str(fd, "pageType");
  const expected = str(fd, "expectedRevision");
  const sectionId = str(fd, "sectionId");
  const intent = str(fd, "intent");
  const failUrl = pagesUrl(storeId);
  try {
    let message = "تغییرات ذخیره شد.";
    let changed = true;
    switch (intent) {
      case "add": {
        ({ changed } = await addSection(user.id, storeId, pageType, { type: str(fd, "sectionType") }, expected));
        message = "بخش اضافه شد.";
        break;
      }
      case "update": {
        // The section's type comes from the stored page, never from the form.
        const view = await getPageEditor(user.id, storeId, pageType);
        const current = view.sections.find((s) => s.id === sectionId);
        if (!current) throw new NotFoundError();
        const def = getSectionDefinition(current.type);
        if (!def) throw new NotFoundError();
        const props = propsFromFields(def.fields, (name) => (fd.has(`f_${name}`) ? str(fd, `f_${name}`) : null));
        ({ changed } = await updateSection(user.id, storeId, pageType, sectionId, props, expected));
        message = "بخش ذخیره شد.";
        break;
      }
      case "remove":
        ({ changed } = await removeSection(user.id, storeId, pageType, sectionId, expected));
        message = "بخش حذف شد.";
        break;
      case "removeDormant":
        ({ changed } = await removeDormantSection(user.id, storeId, pageType, sectionId, expected));
        message = "بخش غیرفعال حذف شد.";
        break;
      case "up":
      case "down":
        ({ changed } = await moveSection(user.id, storeId, pageType, sectionId, intent, expected));
        message = "ترتیب بخش‌ها تغییر کرد.";
        break;
      case "visibility":
        ({ changed } = await setPageVisibility(user.id, storeId, pageType, str(fd, "visible") === "true", expected));
        message = "وضعیت نمایش صفحه تغییر کرد.";
        break;
      case "recover":
        ({ changed } = await recoverPage(user.id, storeId, pageType, expected));
        message = "بخش‌های نامعتبر به بایگانی منتقل شدند. هیچ داده‌ای حذف نشد.";
        break;
      default:
        throw new ValidationError({ _form: ["عملیات نامعتبر است"] });
    }
    revalidatePath(pagesUrl(storeId));
    return { success: changed ? message : "تغییری وجود نداشت.", sectionId: sectionId || undefined };
  } catch (e) {
    return toState(e, failUrl, sectionId || undefined);
  }
}

/** Colour and typography (closed allow-lists, validated by the store schema). Goes through the store update with its conflict handling. */
export async function updateAppearanceAction(_prev: EditorState, fd: FormData): Promise<EditorState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  try {
    await updateStore(user.id, storeId, {
      primaryColor: str(fd, "primaryColor"),
      typography: { sizeScale: str(fd, "sizeScale"), headingWeight: str(fd, "headingWeight"), bodyWeight: str(fd, "bodyWeight") },
    });
  } catch (e) {
    return toState(e, `/dashboard/stores/${encodeURIComponent(storeId)}`);
  }
  revalidatePath(appearanceUrl(storeId));
  return { success: "ظاهر فروشگاه ذخیره شد." };
}
