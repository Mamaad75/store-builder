"use client";

import { useActionState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { FormState } from "@/app/actions-auth";

interface Props {
  mode: "login" | "register";
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  callbackUrl?: string;
}

export default function AuthForm({ mode, action, callbackUrl }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const isRegister = mode === "register";
  const fe = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate>
      <Stack spacing={2}>
        {state.error && <Alert severity="error">{state.error}</Alert>}
        {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
        {isRegister && (
          <TextField name="name" label="نام" autoComplete="name" required error={!!fe.name} helperText={fe.name?.[0]} />
        )}
        <TextField
          name="email"
          type="email"
          label="ایمیل"
          autoComplete="email"
          required
          error={!!fe.email}
          helperText={fe.email?.[0]}
          slotProps={{ htmlInput: { dir: "ltr" } }}
        />
        <TextField
          name="password"
          type="password"
          label="رمز عبور"
          autoComplete={isRegister ? "new-password" : "current-password"}
          required
          error={!!fe.password}
          helperText={fe.password?.[0] ?? (isRegister ? "حداقل ۸ کاراکتر" : undefined)}
          slotProps={{ htmlInput: { dir: "ltr" } }}
        />
        <Button type="submit" variant="contained" size="large" disabled={pending}>
          {isRegister ? "ثبت‌نام" : "ورود"}
        </Button>
      </Stack>
    </form>
  );
}
