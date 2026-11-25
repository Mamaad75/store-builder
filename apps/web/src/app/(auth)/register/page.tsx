import type { Metadata } from "next";
import Link from "next/link";
import Typography from "@mui/material/Typography";
import { RegisterForm } from "@/components/BoundForms";
import { callApi } from "@/lib/api-client";

export const metadata: Metadata = { title: "ثبت‌نام", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** MVP item 2: whether sign-up needs an invitation code. Unknown (API down) = assume it does (the API decides anyway). */
async function registrationMode(): Promise<"invite" | "open"> {
  try {
    const r = await callApi<{ mode: "invite" | "open" }>("GET", "/api/auth/registration");
    return r.status === 200 && r.body?.mode === "open" ? "open" : "invite";
  } catch {
    return "invite";
  }
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const [mode, { invite }] = await Promise.all([registrationMode(), searchParams]);
  const code = typeof invite === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(invite) ? invite : "";
  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        ساخت حساب کاربری
      </Typography>
      <RegisterForm invite={{ required: mode === "invite", code }} />
      <Typography variant="body2" sx={{ mt: 2 }}>
        قبلاً ثبت‌نام کرده‌اید؟ <Link href="/login">ورود</Link>
      </Typography>
    </>
  );
}
