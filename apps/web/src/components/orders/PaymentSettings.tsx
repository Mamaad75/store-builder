"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ZARINPAL_MERCHANT_ID_RE } from "@store-builder/shared/modules/orders/orders";
import { deleteZarinpalMerchant, getPaymentSettings, setZarinpalMerchant, type PaymentSettingsView } from "@/client/api";
import { failText } from "./labels";

/**
 * Phase 3.5: the store's Zarinpal merchant id (write-only: stored encrypted, never shown again) and whether shoppers can pay online now.
 * The return address's domain must be the domain registered for the merchant's Zarinpal terminal, or Zarinpal refuses the payment.
 */
export default function PaymentSettings({ storeId }: { storeId: string }) {
  const [view, setView] = useState<PaymentSettingsView | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getPaymentSettings(storeId).then(setView).catch((e) => setError(failText(e))), [storeId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(f: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await f();
      setValue("");
      setDone(ok);
      await load();
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }

  const trimmed = value.trim();
  const valid = ZARINPAL_MERCHANT_ID_RE.test(trimmed);
  if (!view) return error ? <Alert severity="error">{error}</Alert> : <Typography color="text.secondary">در حال بارگذاری…</Typography>;
  const domain = view.callbackUrl ? new URL(view.callbackUrl).host : null;

  return (
    <Box sx={{ display: "grid", gap: 2, maxWidth: 720 }}>
      {error && <Alert severity="error">{error}</Alert>}
      {done && <Alert severity="success">{done}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
        <Typography sx={{ fontWeight: 700 }}>وضعیت:</Typography>
        {view.active ? <Chip color="success" label="فعال — خریداران می‌توانند آنلاین پرداخت کنند" /> : <Chip label="غیرفعال" />}
        {view.platformEnabled && view.sandbox && <Chip color="warning" variant="outlined" label="حالت آزمایشی (سندباکس): پرداخت واقعی انجام نمی‌شود" />}
      </Paper>

      {!view.platformEnabled && <Alert severity="info">پرداخت آنلاین هنوز از طرف پلتفرم فعال نشده است. می‌توانید مرچنت‌کد را از همین حالا ثبت کنید.</Alert>}
      {!view.secretsReady && <Alert severity="warning">ذخیره‌ی امن کلیدها روی این سرور پیکربندی نشده است؛ فعلاً ثبت مرچنت‌کد ممکن نیست.</Alert>}
      {view.merchantConfigured && !view.merchantValid && <Alert severity="error">مرچنت‌کد ثبت‌شده معتبر نیست (۳۶ نویسه مثل xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). دوباره واردش کنید.</Alert>}

      <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
        <Typography sx={{ fontWeight: 700 }}>مرچنت‌کد زرین‌پال</Typography>
        <Typography variant="body2" color="text.secondary">
          {view.merchantConfigured ? "مرچنت‌کد ثبت شده است (برای امنیت نمایش داده نمی‌شود). برای تغییر، مقدار جدید را وارد کنید." : "مرچنت‌کد را از پنل زرین‌پال، بخش «درگاه‌های پرداخت»، کپی کنید."}
        </Typography>
        <TextField
          label="مرچنت‌کد (۳۶ نویسه)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={trimmed.length > 0 && !valid}
          helperText={trimmed.length > 0 && !valid ? "قالب درست: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" : " "}
          slotProps={{ htmlInput: { dir: "ltr", maxLength: 64, autoComplete: "off", spellCheck: false } }}
          size="small"
          disabled={!view.secretsReady}
        />
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button variant="contained" disabled={busy || !valid || !view.secretsReady} onClick={() => act(() => setZarinpalMerchant(storeId, trimmed.toLowerCase()), "مرچنت‌کد ذخیره شد.")}>ذخیره</Button>
          {view.merchantConfigured && (
            <Button
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={() => window.confirm("مرچنت‌کد حذف شود؟ پرداخت آنلاین فروشگاه خاموش می‌شود.") && act(() => deleteZarinpalMerchant(storeId), "مرچنت‌کد حذف شد؛ پرداخت آنلاین خاموش است.")}
            >
              حذف
            </Button>
          )}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1 }}>
        <Typography sx={{ fontWeight: 700 }}>دامنه‌ی درگاه</Typography>
        <Typography variant="body2">
          زرین‌پال فقط به دامنه‌ای که هنگام ساخت درگاه ثبت کرده‌اید برمی‌گرداند. دامنه‌ی ثبت‌شده‌ی درگاهتان باید این باشد:
        </Typography>
        {domain ? <Typography dir="ltr" sx={{ fontFamily: "monospace", fontWeight: 700 }}>{domain}</Typography> : <Typography color="text.secondary">فروشگاه هنوز نشانی ندارد.</Typography>}
        <Typography variant="body2" color="text.secondary">
          اگر دامنه‌ی درگاه با این نشانی یکی نباشد، پرداخت با خطای «دامنه‌ی بازگشت نامعتبر» رد می‌شود. پرداخت‌های تأییدنشده ظرف حداکثر ۷۲ ساعت به خریدار برمی‌گردند.
        </Typography>
      </Paper>
    </Box>
  );
}
