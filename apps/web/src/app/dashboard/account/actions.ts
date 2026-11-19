import * as api from "@/client/api";
import { ApiHttpError, ApiUnavailableError } from "@/client/http";
import { hardGo } from "@/client/nav";
import { RATE_LIMIT_ERROR, UNAVAILABLE_ERROR, type FormState } from "@/app/actions-auth";

/** Browser-side handlers of the account page (no Server Actions). Every session, this one included, ends on success. */
const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export async function changePasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    await api.changePassword({ currentPassword: str(fd, "currentPassword"), newPassword: str(fd, "newPassword") });
  } catch (e) {
    if (e instanceof ApiUnavailableError) return { error: UNAVAILABLE_ERROR };
    if (e instanceof ApiHttpError) {
      const body = (e as ApiHttpError & { body?: { fieldErrors?: Record<string, string[]> } }).body;
      if (e.status === 429) return { error: RATE_LIMIT_ERROR };
      if (e.status === 400) return { error: "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: body?.fieldErrors };
      if (e.status === 401) {
        hardGo("/login");
        return {};
      }
    }
    return { error: UNAVAILABLE_ERROR };
  }
  hardGo("/login?notice=password-changed");
  return {};
}

export async function signOutEverywhereAction(): Promise<void> {
  try {
    await api.logoutAll();
  } catch {
    hardGo("/dashboard/account"); // not signed out everywhere: stay and let the person retry
    return;
  }
  hardGo("/login?notice=signed-out-everywhere");
}
