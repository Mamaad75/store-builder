"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ORDER_SMS_KINDS, ORDER_SMS_LABELS } from "@store-builder/shared/modules/notifications/order-sms";
import { formatIranMobile } from "@store-builder/shared/lib/phone";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { getSmsSettings, putSmsSettings, type StoreSmsView } from "@/client/api";
import { failText } from "./labels";

/**
 * Phase 3.6: the store's order SMS: on or off, the merchant's mobile (new orders, receipts to review), which messages the platform sends,
 * and this month's usage against the platform's cap. The SMS are sent from the platform's account.
 */
export default function SmsSettings({ storeId }: { storeId: string }) {
  const [view, setView] = useState<StoreSmsView | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSmsSettings(storeId)
      .then((v) => {
        setView(v);
        setEnabled(v.enabled);
        setPhone(v.merchantPhone ? formatIranMobile(v.merchantPhone).replace(/\s/g, "") : "");
      })
      .catch((e) => setError(failText(e)));
  }, [storeId]);

  async function save() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setView(await putSmsSettings(storeId, { enabled, merchantPhone: phone }));
      setDone("تنظیمات پیامک ذخیره شد.");
    } catch (e) {
      setError(e instanceof ValidationError ? (Object.values(e.fieldErrors).flat()[0] ?? "اطلاعات را بررسی کنید.") : failText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!view) return error ? <Alert severity="error">{error}</Alert> : <Typography color="text.secondary">در حال بارگذاری…</Typography>;
  const pct = view.monthlyCap > 0 ? Math.min(100, (view.usedThisMonth / view.monthlyCap) * 100) : 100;
  return (
    <Box sx={{ display: "grid", gap: 2, maxWidth: 720 }}>
      {!view.platformEnabled && <Alert severity="info">پیامک‌های سفارش هنوز از طرف پلتفرم فعال نشده است. تنظیمات شما ذخیره می‌شود و با فعال شدن اعمال می‌شود.</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {done && <Alert severity="success">{done}</Alert>}
      <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
        <FormControlLabel control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />} label="پیامک‌های سفارش برای این فروشگاه فرستاده شود" />
        <TextField
          label="موبایل فروشنده (برای سفارش تازه و رسید کارت به کارت)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          helperText="خالی بگذارید تا پیامکی برای خودتان فرستاده نشود؛ پیامک‌های خریدار جداست."
          size="small"
          slotProps={{ htmlInput: { dir: "ltr", inputMode: "tel", maxLength: 20 } }}
        />
        <Box><Button variant="contained" onClick={save} disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره"}</Button></Box>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1 }}>
        <Typography sx={{ fontWeight: 700 }}>مصرف این ماه</Typography>
        <Typography variant="body2">
          {view.usedThisMonth.toLocaleString("fa-IR")} از {view.monthlyCap.toLocaleString("fa-IR")} پیامک
        </Typography>
        <LinearProgress variant="determinate" value={pct} color={pct >= 100 ? "error" : pct >= 80 ? "warning" : "primary"} aria-label="مصرف پیامک این ماه" />
        {pct >= 100 && <Typography variant="body2" color="error">سقف این ماه پر شده است؛ پیامک‌های سفارش تا ماه بعد فرستاده نمی‌شوند.</Typography>}
      </Paper>
      <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 0.5 }}>
        <Typography sx={{ fontWeight: 700 }}>پیامک‌ها</Typography>
        {ORDER_SMS_KINDS.map((k) => (
          <Typography key={k} variant="body2" color={view.available.includes(k) ? "text.primary" : "text.disabled"}>
            {view.available.includes(k) ? "✓" : "—"} {ORDER_SMS_LABELS[k]}
          </Typography>
        ))}
      </Paper>
    </Box>
  );
}
