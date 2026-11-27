import type { Metadata } from "next";
import Link from "next/link";
import Alert from "@mui/material/Alert";
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

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ invite?: string; ref?: string }> }) {
  const [mode, { invite, ref }] = await Promise.all([registrationMode(), searchParams]);
  // A friend's referral code: only shown (and only if it looks like one); the new owner enters it under Finance > Invite friends after making a store.
  const refCode = typeof ref === "string" && /^[A-HJ-NP-Za-hj-np-z2-9]{8}$/.test(ref) ? ref.toUpperCase() : "";
  const code = typeof invite === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(invite) ? invite : "";
  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        ساخت حساب کاربری
      </Typography>
      {refCode && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="ref-banner">
          شما با کد معرف <bdi dir="ltr">{refCode}</bdi> دعوت شده‌اید. پس از ساخت فروشگاه، این کد را در بخش «مالی ← دعوت از دوستان» ثبت کنید تا ۱۰٪ تخفیف اولین خرید اشتراک را بگیرید.
        </Alert>
      )}
      <RegisterForm invite={{ required: mode === "invite", code }} />
      <Typography variant="body2" sx={{ mt: 2 }}>
        قبلاً ثبت‌نام کرده‌اید؟ <Link href="/login">ورود</Link>
      </Typography>
    </>
  );
}
