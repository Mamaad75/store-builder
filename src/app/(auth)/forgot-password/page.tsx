import type { Metadata } from "next";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import { forgotPasswordAction } from "@/app/actions-auth";
import { ForgotPasswordForm } from "@/components/AccountForms";

export const metadata: Metadata = { title: "بازیابی رمز عبور", robots: { index: false, follow: false } };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        بازیابی رمز عبور
      </Typography>
      {sent ? (
        <Alert severity="success" data-testid="forgot-sent" sx={{ mb: 2 }}>
          اگر حسابی با این ایمیل وجود داشته باشد، پیوند بازیابی رمز عبور برای آن ارسال شد. پیوند تا یک ساعت معتبر است.
        </Alert>
      ) : (
        <>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            ایمیل حساب خود را وارد کنید تا پیوند تعیین رمز عبور جدید برایتان ارسال شود.
          </Typography>
          <ForgotPasswordForm action={forgotPasswordAction} />
        </>
      )}
      <Typography variant="body2" sx={{ mt: 2 }}>
        <Link href="/login">بازگشت به ورود</Link>
      </Typography>
    </>
  );
}
