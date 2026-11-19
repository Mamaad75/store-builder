"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApiUnavailableError, callApi } from "@/lib/api-client";
import { applyApiCookies, sessionCookieHeader, UNAVAILABLE_ERROR } from "@/lib/session-bff";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";
import { getClientIp } from "@/lib/client-ip";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

const GENERIC_LOGIN_ERROR = "نام کاربری یا رمز عبور نادرست است.";
const RATE_LIMIT_ERROR = "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً چند دقیقه بعد دوباره تلاش کنید.";

type Problem = { code?: string; fieldErrors?: Record<string, string[]> };

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ip = getClientIp(await headers());
  let r;
  try {
    r = await callApi<Problem>("POST", "/api/auth/register", {
      ip,
      body: { name: formData.get("name"), username: formData.get("username"), password: formData.get("password") },
    });
  } catch (e) {
    if (e instanceof ApiUnavailableError) return { error: UNAVAILABLE_ERROR };
    throw e;
  }
  if (r.status === 201) redirect("/login?registered=1");
  if (r.status === 429) return { error: RATE_LIMIT_ERROR };
  if (r.status === 409) return { error: "این نام کاربری قبلاً گرفته شده است. نام دیگری انتخاب کنید.", fieldErrors: r.body?.fieldErrors };
  if (r.status === 400) return { error: "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: r.body?.fieldErrors };
  return { error: UNAVAILABLE_ERROR };
}

/** Only same-site relative paths are allowed as post-login destinations. */
function safeCallbackUrl(value: FormDataEntryValue | null): string {
  return typeof value === "string" && /^\/dashboard(\/|$)/.test(value) && !value.startsWith("//") ? value : "/dashboard";
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ip = getClientIp(await headers());
  let r;
  try {
    r = await callApi<Problem>("POST", "/api/auth/login", { ip, body: { username: formData.get("username"), password: formData.get("password") } });
  } catch (e) {
    if (e instanceof ApiUnavailableError) return { error: UNAVAILABLE_ERROR };
    throw e;
  }
  if (r.status === 429) return { error: RATE_LIMIT_ERROR };
  if (r.status === 401 || r.status === 400) return { error: GENERIC_LOGIN_ERROR };
  if (r.status !== 200) return { error: UNAVAILABLE_ERROR };
  await applyApiCookies(r.setCookies);
  redirect(safeCallbackUrl(formData.get("callbackUrl")));
}

export async function logoutAction() {
  const cookie = await sessionCookieHeader();
  try {
    const r = await callApi("POST", "/api/auth/logout", { cookie });
    await applyApiCookies(r.setCookies);
  } catch (e) {
    if (!(e instanceof ApiUnavailableError)) throw e;
  }
  // whatever the API said, this browser forgets the session
  const jar = await cookies();
  for (const name of SESSION_COOKIE_NAMES) jar.delete({ name, path: "/" });
  redirect("/login");
}
