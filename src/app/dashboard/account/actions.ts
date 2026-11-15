"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import type { FormState } from "@/app/actions-auth";
import { changePassword, signOutEverywhere } from "@/modules/auth/account";
import { requireUser } from "@/modules/auth/session";

const RATE_LIMIT_ERROR = "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً چند دقیقه بعد دوباره تلاش کنید.";

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await changePassword(user.id, { currentPassword: formData.get("currentPassword"), newPassword: formData.get("newPassword") });
  if (!result.ok) {
    if (result.error === "rate_limited") return { error: RATE_LIMIT_ERROR };
    return { error: "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: result.fieldErrors };
  }
  // every session, this one included, ended with the version bump: sign in again with the new password
  await signOut({ redirectTo: "/login?notice=password-changed" });
  redirect("/login?notice=password-changed");
}

export async function signOutEverywhereAction(): Promise<void> {
  const user = await requireUser();
  await signOutEverywhere(user.id);
  await signOut({ redirectTo: "/login?notice=signed-out-everywhere" });
  redirect("/login?notice=signed-out-everywhere");
}
