"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, CredentialsSignin } from "next-auth";
import { signIn, signOut } from "@/auth";
import { getClientIp } from "@/modules/auth/rate-limit";
import { registerUser } from "@/modules/auth/service";
import { loginSchema } from "@/modules/auth/schemas";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

const GENERIC_LOGIN_ERROR = "ایمیل یا رمز عبور نادرست است.";
const RATE_LIMIT_ERROR = "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً چند دقیقه بعد دوباره تلاش کنید.";

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ip = getClientIp(await headers());
  const result = await registerUser(
    { name: formData.get("name"), email: formData.get("email"), password: formData.get("password") },
    { ip },
  );
  if (!result.ok) {
    if (result.error === "rate_limited") return { error: RATE_LIMIT_ERROR };
    return { error: "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: result.fieldErrors };
  }
  redirect("/login?registered=1");
}

/** Only same-site relative paths are allowed as post-login destinations. */
function safeCallbackUrl(value: FormDataEntryValue | null): string {
  return typeof value === "string" && /^\/dashboard(\/|$)/.test(value) && !value.startsWith("//") ? value : "/dashboard";
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: GENERIC_LOGIN_ERROR };
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeCallbackUrl(formData.get("callbackUrl")),
    });
  } catch (e) {
    if (e instanceof AuthError) {
      const limited = e instanceof CredentialsSignin && e.code === "rate_limited";
      return { error: limited ? RATE_LIMIT_ERROR : GENERIC_LOGIN_ERROR };
    }
    throw e; // redirects and unexpected errors
  }
  return {};
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
