"use client";

import Button from "@mui/material/Button";
import { loginAction, registerAction } from "@/app/actions-auth";
import { changePasswordAction, signOutEverywhereAction } from "@/app/dashboard/account/actions";
import { removeProductImageAction, removeStoreLogoAction, uploadProductImageAction, uploadStoreLogoAction } from "@/app/dashboard/media-actions";
import { ChangePasswordForm } from "@/components/AccountForms";
import AuthForm from "@/components/AuthForm";
import ImageUploader from "@/components/ImageUploader";

/**
 * Forms whose handlers run in the browser (ADR 0001: no Server Actions). Server components render these instead of passing handler
 * functions as props, which cannot cross the server/client boundary.
 */
export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  return <AuthForm mode="login" action={loginAction} callbackUrl={callbackUrl} />;
}

export function RegisterForm({ invite }: { invite?: { required: boolean; code: string } }) {
  return <AuthForm mode="register" action={registerAction} invite={invite} />;
}

export function BoundChangePasswordForm() {
  return <ChangePasswordForm action={changePasswordAction} />;
}

export function SignOutEverywhereForm() {
  return (
    <form action={signOutEverywhereAction}>
      <Button type="submit" variant="outlined" color="error">
        خروج از همه دستگاه‌ها
      </Button>
    </form>
  );
}

type UploaderProps = Omit<React.ComponentProps<typeof ImageUploader>, "uploadAction" | "removeAction">;

export function StoreLogoUploader(props: UploaderProps) {
  return <ImageUploader {...props} uploadAction={uploadStoreLogoAction} removeAction={removeStoreLogoAction} />;
}

export function ProductImageUploader(props: UploaderProps) {
  return <ImageUploader {...props} uploadAction={uploadProductImageAction} removeAction={removeProductImageAction} />;
}
