import type { Metadata } from "next";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import { loginAction } from "@/app/actions-auth";
import AuthForm from "@/components/AuthForm";

export const metadata: Metadata = { title: "ورود" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; callbackUrl?: string }>;
}) {
  const { registered, callbackUrl } = await searchParams;
  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        ورود به حساب کاربری
      </Typography>
      {registered && (
        <Alert severity="success" sx={{ mb: 2 }}>
          ثبت‌نام انجام شد. اکنون با ایمیل و رمز عبور خود وارد شوید.
        </Alert>
      )}
      <AuthForm mode="login" action={loginAction} callbackUrl={callbackUrl} />
      <Typography variant="body2" sx={{ mt: 2 }}>
        حساب ندارید؟ <Link href="/register">ثبت‌نام</Link>
      </Typography>
    </>
  );
}
