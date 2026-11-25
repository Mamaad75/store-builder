"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { recoverAccount } from "@/client/api";
import { hardGo } from "@/client/nav";

/** MVP item 2: sets a new password with the recovery link; every other session of the account ends. */
export default function RecoverForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const linkOk = /^[A-Za-z0-9_-]{43}$/.test(token);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("رمز عبور باید حداقل ۸ کاراکتر باشد.");
    if (password !== repeat) return setError("تکرار رمز عبور یکسان نیست.");
    setBusy(true);
    try {
      await recoverAccount(token, password);
      hardGo("/login?notice=recovered");
    } catch (err) {
      // /api/auth/* answers { code, fieldErrors } (ApiHttpError with the status and the body).
      const e = err as { status?: number; body?: { fieldErrors?: Record<string, string[]> } };
      const fe = e.body?.fieldErrors;
      setError(e.status === 429 ? "تلاش‌های زیادی انجام شد؛ کمی بعد دوباره امتحان کنید." : (fe?.token?.[0] ?? fe?.newPassword?.[0] ?? "پیوند بازیابی نامعتبر یا منقضی است. از پشتیبانی پیوند تازه بخواهید."));
      setBusy(false);
    }
  }

  if (!linkOk) return <Alert severity="error">پیوند بازیابی ناقص یا نامعتبر است. پیوند کامل را از پشتیبانی بگیرید.</Alert>;
  return (
    <form onSubmit={submit} noValidate>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField type="password" label="رمز عبور تازه" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required helperText="حداقل ۸ کاراکتر" slotProps={{ htmlInput: { dir: "ltr" } }} />
        <TextField type="password" label="تکرار رمز عبور تازه" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required slotProps={{ htmlInput: { dir: "ltr" } }} />
        <Button type="submit" variant="contained" size="large" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت رمز عبور تازه"}</Button>
      </Stack>
    </form>
  );
}
