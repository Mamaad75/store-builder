"use client";

import { useActionState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { FormState } from "@/app/actions-auth";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;
const ltr = { htmlInput: { dir: "ltr" as const } };

function Shell({ action, submit, children }: { action: Action; submit: string; children: (fe: Record<string, string[]>) => ReactNode }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} noValidate>
      <Stack spacing={2}>
        {state.error && <Alert severity="error" role="alert">{state.error}</Alert>}
        {children(state.fieldErrors ?? {})}
        <Button type="submit" variant="contained" size="large" disabled={pending}>
          {submit}
        </Button>
      </Stack>
    </form>
  );
}

export function ChangePasswordForm({ action }: { action: Action }) {
  return (
    <Shell action={action} submit="تغییر رمز عبور">
      {(fe) => (
        <>
          <TextField name="currentPassword" type="password" label="رمز عبور فعلی" autoComplete="current-password" required error={!!fe.currentPassword} helperText={fe.currentPassword?.[0]} slotProps={ltr} />
          <TextField name="newPassword" type="password" label="رمز عبور جدید" autoComplete="new-password" required error={!!fe.newPassword} helperText={fe.newPassword?.[0] ?? "حداقل ۸ کاراکتر"} slotProps={ltr} />
        </>
      )}
    </Shell>
  );
}
