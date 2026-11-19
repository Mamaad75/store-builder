import * as api from "@/client/api";
import { transportState } from "@/client/guard";
import { go, refresh } from "@/client/nav";
import { PageNeedsRecoveryError, SectionLimitError, UnsupportedTemplateError } from "@store-builder/shared/modules/pages/errors";
import { pagesUrl } from "@store-builder/shared/modules/pages/urls";
import { ConflictError, DRAFT_BUSY_MESSAGE, DraftBusyError, NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { propsFromFields } from "@store-builder/shared/templates/section-fields";
import { getSectionDefinition } from "@store-builder/shared/templates/section-registry";

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
  const transport = transportState(e);
  if (transport) return transport;
  if (e instanceof NotFoundError) {
    go(notFoundUrl);
    return {};
  }
  if (e instanceof ValidationError) {
    const first = Object.values(e.fieldErrors).flat()[0];
    return { error: first ?? "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: e.fieldErrors, sectionId };
  }
  if (e instanceof ConflictError) return { error: "این صفحه هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید." };
  if (e instanceof DraftBusyError) return { error: DRAFT_BUSY_MESSAGE };
  if (e instanceof PageNeedsRecoveryError) {
    return { error: `این صفحه ${e.invalidCount.toLocaleString("fa-IR")} بخش نامعتبر دارد. ابتدا «انتقال به بایگانی» را اجرا کنید؛ هیچ داده‌ای حذف نمی‌شود.` };
  }
  if (e instanceof SectionLimitError) return { error: `حداکثر ${e.limit.toLocaleString("fa-IR")} بخش در هر صفحه مجاز است.` };
  if (e instanceof UnsupportedTemplateError) return { error: "قالب این فروشگاه هنوز قابل ویرایش نیست." };
  throw e;
}

/** One action for every editor button; `intent` selects a whitelisted operation. All of them are draft-only. */
export async function pageEditAction(_prev: EditorState, fd: FormData): Promise<EditorState> {
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
        ({ changed } = await api.addSection(storeId, pageType, { type: str(fd, "sectionType") }, expected));
        message = "بخش اضافه شد.";
        break;
      }
      case "update": {
        // The section's type comes from the stored page, never from the form.
        const view = await api.getPageEditor(storeId, pageType);
        const current = view.sections.find((s) => s.id === sectionId);
        if (!current) throw new NotFoundError();
        const def = getSectionDefinition(current.type);
        if (!def) throw new NotFoundError();
        const props = propsFromFields(def.fields, (name) => (fd.has(`f_${name}`) ? str(fd, `f_${name}`) : null));
        ({ changed } = await api.updateSection(storeId, pageType, sectionId, props, expected));
        message = "بخش ذخیره شد.";
        break;
      }
      case "remove":
        ({ changed } = await api.removeSection(storeId, pageType, sectionId, expected));
        message = "بخش حذف شد.";
        break;
      case "removeDormant":
        ({ changed } = await api.removeDormantSection(storeId, pageType, sectionId, expected));
        message = "بخش غیرفعال حذف شد.";
        break;
      case "up":
      case "down":
        ({ changed } = await api.moveSection(storeId, pageType, sectionId, intent, expected));
        message = "ترتیب بخش‌ها تغییر کرد.";
        break;
      case "visibility":
        ({ changed } = await api.setPageVisibility(storeId, pageType, str(fd, "visible") === "true", expected));
        message = "وضعیت نمایش صفحه تغییر کرد.";
        break;
      case "recover":
        ({ changed } = await api.recoverPage(storeId, pageType, expected));
        message = "بخش‌های نامعتبر به بایگانی منتقل شدند. هیچ داده‌ای حذف نشد.";
        break;
      default:
        throw new ValidationError({ _form: ["عملیات نامعتبر است"] });
    }
    refresh();
    return { success: changed ? message : "تغییری وجود نداشت.", sectionId: sectionId || undefined };
  } catch (e) {
    return toState(e, failUrl, sectionId || undefined);
  }
}

/** Colour and typography (closed allow-lists, validated by the store schema). Goes through the store update with its conflict handling. */
export async function updateAppearanceAction(_prev: EditorState, fd: FormData): Promise<EditorState> {
  const storeId = str(fd, "storeId");
  try {
    await api.updateStore(storeId, {
      primaryColor: str(fd, "primaryColor"),
      typography: { sizeScale: str(fd, "sizeScale"), headingWeight: str(fd, "headingWeight"), bodyWeight: str(fd, "bodyWeight") },
    });
  } catch (e) {
    return toState(e, `/dashboard/stores/${encodeURIComponent(storeId)}`);
  }
  refresh();
  return { success: "ظاهر فروشگاه ذخیره شد." };
}
