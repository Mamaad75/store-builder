import * as api from "@/client/api";
import { ApiHttpError, ApiUnavailableError } from "@/client/http";
import { hardGo } from "@/client/nav";

/**
 * Browser-side form handlers for sign-up, sign-in and sign-out (ADR 0001: no Server Actions). They call the API from the browser; the
 * API sets or clears the httpOnly session cookie itself. Only imported by client components.
 */
export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

const GENERIC_LOGIN_ERROR = "نام کاربری یا رمز عبور نادرست است.";
export const RATE_LIMIT_ERROR = "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً چند دقیقه بعد دوباره تلاش کنید.";
export const UNAVAILABLE_ERROR = "سرویس موقتاً در دسترس نیست. چند لحظه بعد دوباره تلاش کنید.";

type Problem = { code?: string; fieldErrors?: Record<string, string[]> };
const problemOf = (e: unknown): { status: number; body: Problem | null } | null => (e instanceof ApiHttpError ? { status: e.status, body: (e as ApiHttpError & { body?: Problem }).body ?? null } : null);

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export async function registerAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const inviteCode = str(fd, "inviteCode").trim();
    await api.register({ name: str(fd, "name"), username: str(fd, "username"), password: str(fd, "password"), ...(inviteCode ? { inviteCode } : {}) });
  } catch (e) {
    if (e instanceof ApiUnavailableError) return { error: UNAVAILABLE_ERROR };
    const p = problemOf(e);
    if (p?.status === 429) return { error: RATE_LIMIT_ERROR };
    if (p?.status === 409) return { error: "این نام کاربری قبلاً گرفته شده است. نام دیگری انتخاب کنید.", fieldErrors: p.body?.fieldErrors };
    if (p?.status === 400) return { error: "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: p.body?.fieldErrors };
    return { error: UNAVAILABLE_ERROR };
  }
  hardGo("/login?registered=1");
  return {};
}

/** Only same-site relative paths are allowed as post-login destinations. */
function safeCallbackUrl(value: FormDataEntryValue | null): string {
  return typeof value === "string" && /^\/dashboard(\/|$)/.test(value) && !value.startsWith("//") ? value : "/dashboard";
}

export async function loginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    await api.login({ username: str(fd, "username"), password: str(fd, "password") });
  } catch (e) {
    if (e instanceof ApiUnavailableError) return { error: UNAVAILABLE_ERROR };
    const p = problemOf(e);
    if (p?.status === 429) return { error: RATE_LIMIT_ERROR };
    if (p?.status === 401 || p?.status === 400) return { error: GENERIC_LOGIN_ERROR };
    return { error: UNAVAILABLE_ERROR };
  }
  hardGo(safeCallbackUrl(fd.get("callbackUrl")));
  return {};
}

export async function logoutAction(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // whatever the API said, the person leaves: an expired session is already signed out
  }
  hardGo("/login");
}
