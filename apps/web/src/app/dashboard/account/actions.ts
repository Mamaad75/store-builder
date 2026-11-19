"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { FormState } from "@/app/actions-auth";
import { applyApiCookies, sessionCookieHeader, UNAVAILABLE_ERROR } from "@/lib/session-bff";
import { ApiUnavailableError, callApi } from "@/lib/api-client";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";
import { getClientIp } from "@/modules/auth/rate-limit";
import { requireUser } from "@/modules/auth/session";

const RATE_LIMIT_ERROR = "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً چند دقیقه بعد دوباره تلاش کنید.";

async function endLocalSession(): Promise<void> {
  const jar = await cookies();
  for (const name of SESSION_COOKIE_NAMES) jar.delete({ name, path: "/" });
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  let r;
  try {
    r = await callApi<{ fieldErrors?: Record<string, string[]> }>("POST", "/api/auth/change-password", {
      cookie: await sessionCookieHeader(),
      ip: getClientIp(await headers()),
      body: { currentPassword: formData.get("currentPassword"), newPassword: formData.get("newPassword") },
    });
  } catch (e) {
    if (e instanceof ApiUnavailableError) return { error: UNAVAILABLE_ERROR };
    throw e;
  }
  if (r.status === 429) return { error: RATE_LIMIT_ERROR };
  if (r.status === 400) return { error: "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: r.body?.fieldErrors };
  if (r.status !== 204) return { error: UNAVAILABLE_ERROR };
  // every session, this one included, ended with the version bump: sign in again with the new password
  await applyApiCookies(r.setCookies);
  await endLocalSession();
  redirect("/login?notice=password-changed");
}

export async function signOutEverywhereAction(): Promise<void> {
  await requireUser();
  const r = await callApi("POST", "/api/auth/logout-all", { cookie: await sessionCookieHeader(), ip: getClientIp(await headers()) }).catch((e) => {
    if (e instanceof ApiUnavailableError) return null;
    throw e;
  });
  if (!r || r.status !== 204) redirect("/dashboard/account"); // not signed out everywhere: stay and let the person retry
  await applyApiCookies(r.setCookies);
  await endLocalSession();
  redirect("/login?notice=signed-out-everywhere");
}
