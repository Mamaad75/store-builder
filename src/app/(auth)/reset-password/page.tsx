import type { Metadata } from "next";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import { resetPasswordAction } from "@/app/actions-auth";
import { ResetPasswordForm } from "@/components/AccountForms";
import { isResetTokenUsable } from "@/modules/auth/account";

// The token is in the URL: never index it and never leak it through the Referer header.
export const metadata: Metadata = { title: "تعیین رمز عبور جدید", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const usable = await isResetTokenUsable(token);
  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        تعیین رمز عبور جدید
      </Typography>
      {usable ? (
        <ResetPasswordForm action={resetPasswordAction} token={token} />
      ) : (
        <Alert severity="error" data-testid="reset-invalid">
          این پیوند نامعتبر یا منقضی شده است. <Link href="/forgot-password">دوباره درخواست بازیابی بدهید</Link>.
        </Alert>
      )}
    </>
  );
}
