"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import {
  ConfirmationRequiredError,
  IncompatibleVersionError,
  NoChangesError,
  PublishBusyError,
  PublishDataError,
  PublishRateLimitedError,
  PublishTimedOutError,
  RedirectLimitError,
  ReservedLabelLimitError,
  ReservedSlugLimitError,
  SlugHistoryLimitError,
  SlugReservationConflictError,
  SnapshotTextError,
  SnapshotTooLargeError,
  StoreAlreadyLiveError,
  StoreNotLiveError,
  SubdomainRequiredError,
  SubdomainReservedError,
  SubdomainTakenError,
  VersionAlreadyLiveError,
} from "@/modules/publishing/errors";
import { publishStore, setLiveVersion, unpublishStore } from "@/modules/publishing/service";
import { claimSubdomain } from "@/modules/publishing/subdomain";
import { ConflictError, NotFoundError, ValidationError } from "@/modules/stores/errors";

export interface PublishState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const fa = (n: number) => n.toLocaleString("fa-IR");
const date = (d: Date) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(d);

/** Every typed outcome has an owner-facing Persian message; anything unexpected is rethrown (never leaked as text). */
function toState(e: unknown, notFoundUrl: string): PublishState {
  if (e instanceof NotFoundError) redirect(notFoundUrl);
  if (e instanceof ValidationError) {
    const first = Object.values(e.fieldErrors).flat()[0];
    return { error: first ?? "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: e.fieldErrors };
  }
  if (e instanceof ConflictError) return { error: "پیش‌نویس پس از بارگذاری این صفحه تغییر کرده است. صفحه را تازه کنید و دوباره بررسی کنید." };
  if (e instanceof SubdomainRequiredError) return { error: "پیش از انتشار باید یک زیردامنه برای فروشگاه ثبت کنید." };
  if (e instanceof NoChangesError) return { error: "پیش‌نویس با نسخهٔ منتشرشده تفاوتی ندارد؛ نسخهٔ جدیدی ساخته نشد." };
  if (e instanceof PublishBusyError) return { error: "عملیات دیگری روی این فروشگاه در حال انجام است. چند لحظه بعد دوباره تلاش کنید." };
  if (e instanceof PublishTimedOutError) return { error: "انتشار در زمان مجاز کامل نشد و هیچ تغییری ثبت نشد. دوباره تلاش کنید." };
  if (e instanceof PublishRateLimitedError) return { error: `حداکثر ${fa(e.limit)} انتشار در هر ساعت مجاز است. حدود ${fa(Math.ceil(e.retryAfterMs / 60_000))} دقیقهٔ دیگر دوباره تلاش کنید.` };
  if (e instanceof SnapshotTooLargeError) return { error: "حجم محتوای فروشگاه از حد مجاز انتشار بیشتر است. تعداد محصولات یا بخش‌ها را کاهش دهید." };
  if (e instanceof SnapshotTextError || e instanceof PublishDataError) return { error: "در محتوای پیش‌نویس داده‌ای وجود دارد که منتشر نمی‌شود. محتوا را بررسی کنید." };
  if (e instanceof SlugHistoryLimitError) {
    const names = e.products.map((p) => p.name).join("، ");
    return { error: `این محصولات بیش از ${fa(e.limit)} نشانی قبلی دارند و تا حل نشدن نمی‌توان منتشر کرد: ${names}` };
  }
  if (e instanceof RedirectLimitError) return { error: `تعداد تغییرمسیرها (${fa(e.count)}) از سقف مجاز ${fa(e.limit)} بیشتر می‌شود. نشانی چند محصول را به حالت قبل برگردانید.` };
  if (e instanceof ReservedSlugLimitError) return { error: `تعداد نشانی‌های رزروشدهٔ فروشگاه به سقف ${fa(e.limit)} رسیده است.` };
  if (e instanceof SlugReservationConflictError) return { error: `نشانی «${e.slug}» برای محصول دیگری رزرو شده است.` };
  if (e instanceof StoreNotLiveError) return { error: "فروشگاه در حال حاضر منتشر نشده است." };
  if (e instanceof StoreAlreadyLiveError) return { error: "فروشگاه هم‌اکنون منتشر است." };
  if (e instanceof VersionAlreadyLiveError) return { error: "این نسخه هم‌اکنون زنده است." };
  if (e instanceof IncompatibleVersionError) return { error: "این نسخه با برنامهٔ فعلی قابل نمایش نیست و نمی‌توان آن را زنده کرد." };
  if (e instanceof SubdomainTakenError) return { error: "این زیردامنه قبلاً گرفته شده است." };
  if (e instanceof SubdomainReservedError) return { error: `این زیردامنه تا ${date(e.until)} رزرو است.` };
  if (e instanceof ReservedLabelLimitError) return { error: `حداکثر ${fa(e.limit)} زیردامنهٔ آزادشده می‌تواند هم‌زمان رزرو باشد. تا ${date(e.until)} صبر کنید.` };
  if (e instanceof ConfirmationRequiredError) return { error: "تغییر زیردامنهٔ فروشگاه منتشرشده نیاز به تأیید دارد؛ نشانی قبلی بلافاصله از کار می‌افتد." };
  throw e;
}

const url = (storeId: string) => `/dashboard/stores/${encodeURIComponent(storeId)}/publish`;
const notFound = () => "/dashboard";

/** Identity from the session only; input from an explicit whitelist; the owner-scoped service does the rest. */
export async function publishAction(_prev: PublishState, fd: FormData): Promise<PublishState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  try {
    const r = await publishStore(user.id, storeId, { expectedDraftRevision: str(fd, "expectedDraftRevision") });
    revalidatePath(url(storeId));
    return { success: `نسخهٔ ${fa(r.number)} منتشر شد.` };
  } catch (e) {
    return toState(e, notFound());
  }
}

export async function unpublishAction(_prev: PublishState, fd: FormData): Promise<PublishState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  try {
    await unpublishStore(user.id, storeId);
    revalidatePath(url(storeId));
    return { success: "فروشگاه از دسترس خارج شد. همهٔ نسخه‌ها نگه داشته شده‌اند." };
  } catch (e) {
    return toState(e, notFound());
  }
}

export async function setLiveVersionAction(_prev: PublishState, fd: FormData): Promise<PublishState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  const mode = str(fd, "mode") === "republish" ? "republish" : "rollback";
  try {
    const r = await setLiveVersion(user.id, storeId, { versionNumber: str(fd, "versionNumber"), mode });
    revalidatePath(url(storeId));
    return { success: mode === "rollback" ? `نسخهٔ ${fa(r.number)} اکنون زنده است.` : `فروشگاه با نسخهٔ ${fa(r.number)} دوباره منتشر شد.` };
  } catch (e) {
    return toState(e, notFound());
  }
}

export async function claimSubdomainAction(_prev: PublishState, fd: FormData): Promise<PublishState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  try {
    const r = await claimSubdomain(user.id, storeId, { label: str(fd, "label"), confirmChange: str(fd, "confirmChange") });
    revalidatePath(url(storeId));
    return { success: r.changed ? `زیردامنهٔ «${r.label}» ثبت شد.` : "زیردامنه بدون تغییر ماند." };
  } catch (e) {
    return toState(e, notFound());
  }
}
