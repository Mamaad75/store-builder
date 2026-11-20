import type { Metadata } from "next";
import Link from "next/link";
import Typography from "@mui/material/Typography";
import { RegisterForm } from "@/components/BoundForms";

export const metadata: Metadata = { title: "ثبت‌نام", robots: { index: false, follow: false } };

export default function RegisterPage() {
  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        ساخت حساب کاربری
      </Typography>
      <RegisterForm />
      <Typography variant="body2" sx={{ mt: 2 }}>
        قبلاً ثبت‌نام کرده‌اید؟ <Link href="/login">ورود</Link>
      </Typography>
    </>
  );
}
