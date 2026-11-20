import type { Metadata } from "next";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import { LoginForm } from "@/components/BoundForms";

export const metadata: Metadata = { title: "ورود", robots: { index: false, follow: false } };

const NOTICES: Record<string, string> = {
  "password-changed": "رمز عبور تغییر کرد. با رمز جدید وارد شوید.",
  "signed-out-everywhere": "از همه دستگاه‌ها خارج شدید.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; callbackUrl?: string; notice?: string }>;
}) {
  const { registered, callbackUrl, notice } = await searchParams;
  const noticeText = notice ? NOTICES[notice] : undefined;
  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        ورود به حساب کاربری
      </Typography>
      {registered && (
        <Alert severity="success" sx={{ mb: 2 }}>
          ثبت‌نام انجام شد. اکنون با نام کاربری و رمز عبور خود وارد شوید.
        </Alert>
      )}
      {noticeText && (
        <Alert severity="success" data-testid="login-notice" sx={{ mb: 2 }}>
          {noticeText}
        </Alert>
      )}
      <LoginForm callbackUrl={callbackUrl} />
      <Typography variant="body2" sx={{ mt: 2 }}>
        حساب ندارید؟ <Link href="/register">ثبت‌نام</Link>
      </Typography>
    </>
  );
}
