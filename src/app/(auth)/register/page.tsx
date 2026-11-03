import type { Metadata } from "next";
import Link from "next/link";
import Typography from "@mui/material/Typography";
import { registerAction } from "@/app/actions-auth";
import AuthForm from "@/components/AuthForm";

export const metadata: Metadata = { title: "ثبت‌نام" };

export default function RegisterPage() {
  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        ساخت حساب کاربری
      </Typography>
      <AuthForm mode="register" action={registerAction} />
      <Typography variant="body2" sx={{ mt: 2 }}>
        قبلاً ثبت‌نام کرده‌اید؟ <Link href="/login">ورود</Link>
      </Typography>
    </>
  );
}
