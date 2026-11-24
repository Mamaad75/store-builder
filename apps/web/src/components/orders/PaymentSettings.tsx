"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { GATEWAY_CREDENTIAL_RE, GATEWAY_LABELS, type Gateway } from "@store-builder/shared/modules/orders/orders";
import { deleteGatewayCredential, getPaymentSettings, setGatewayCredential, type PaymentSettingsView } from "@/client/api";
import { failText } from "./labels";

/** What each gateway calls its credential and where the merchant finds it. */
const CREDENTIAL: Record<Gateway, { label: string; where: string; shape: string; caseSensitive: boolean }> = {
  ZARINPAL: { label: "مرچنت‌کد (۳۶ نویسه)", where: "پنل زرین‌پال، بخش «درگاه‌های پرداخت»", shape: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", caseSensitive: false },
  AQAYEPARDAKHT: { label: "پین درگاه", where: "پنل آقای پرداخت، بخش «درگاه‌های پرداخت»", shape: "حروف انگلیسی و عدد، دست‌کم ۸ نویسه", caseSensitive: true },
};

type GatewayState = PaymentSettingsView["gateways"][number];

/**
 * Phase 3.5 / D35c-1: one card per online gateway. The credential is write-only (stored encrypted, never shown again). The return
 * address's domain must be the domain registered for the merchant's gateway, or the gateway refuses the payment.
 */
export default function PaymentSettings({ storeId }: { storeId: string }) {
  const [view, setView] = useState<PaymentSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => getPaymentSettings(storeId).then(setView).catch((e) => setError(failText(e))), [storeId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return error ? <Alert severity="error">{error}</Alert> : <Typography color="text.secondary">در حال بارگذاری…</Typography>;
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      {view.sandbox && <Alert severity="warning">پلتفرم در حالت آزمایشی (سندباکس) است: پرداخت واقعی انجام نمی‌شود.</Alert>}
      {!view.secretsReady && <Alert severity="warning">ذخیره‌ی امن کلیدها روی این سرور پیکربندی نشده است؛ فعلاً ثبت کد درگاه ممکن نیست.</Alert>}
      <Typography variant="body2" color="text.secondary">اگر چند درگاه فعال باشد، خریدار در صفحه‌ی خرید یکی را انتخاب می‌کند.</Typography>
      {view.gateways.map((g) => (
        <GatewayCard key={g.gateway} storeId={storeId} g={g} secretsReady={view.secretsReady} onChange={load} />
      ))}
    </Box>
  );
}

function GatewayCard({ storeId, g, secretsReady, onChange }: { storeId: string; g: GatewayState; secretsReady: boolean; onChange: () => Promise<unknown> }) {
  const c = CREDENTIAL[g.gateway];
  const name = GATEWAY_LABELS[g.gateway];
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();
  const valid = GATEWAY_CREDENTIAL_RE[g.gateway].test(trimmed);
  const domain = g.callbackUrl ? new URL(g.callbackUrl).host : null;

  async function act(f: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await f();
      setValue("");
      setDone(ok);
      await onChange();
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <Typography sx={{ fontWeight: 700 }}>{name}</Typography>
        {g.active ? <Chip size="small" color="success" label="فعال" /> : <Chip size="small" label="غیرفعال" />}
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {done && <Alert severity="success">{done}</Alert>}
      {!g.platformEnabled && <Alert severity="info">پرداخت با {name} هنوز از طرف پلتفرم فعال نشده است. می‌توانید کد درگاه را از همین حالا ثبت کنید.</Alert>}
      {g.configured && !g.valid && <Alert severity="error">کد ثبت‌شده معتبر نیست ({c.shape}). دوباره واردش کنید.</Alert>}
      <Typography variant="body2" color="text.secondary">
        {g.configured ? "کد درگاه ثبت شده است (برای امنیت نمایش داده نمی‌شود). برای تغییر، مقدار جدید را وارد کنید." : `${c.label} را از ${c.where} کپی کنید.`}
      </Typography>
      <TextField
        label={c.label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={trimmed.length > 0 && !valid}
        helperText={trimmed.length > 0 && !valid ? `قالب درست: ${c.shape}` : " "}
        slotProps={{ htmlInput: { dir: "ltr", maxLength: 64, autoComplete: "off", spellCheck: false } }}
        size="small"
        disabled={!secretsReady}
      />
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Button variant="contained" disabled={busy || !valid || !secretsReady} onClick={() => act(() => setGatewayCredential(storeId, g.gateway, c.caseSensitive ? trimmed : trimmed.toLowerCase()), "کد درگاه ذخیره شد.")}>ذخیره</Button>
        {g.configured && (
          <Button
            variant="outlined"
            color="error"
            disabled={busy}
            onClick={() => window.confirm(`کد ${name} حذف شود؟ پرداخت با این درگاه خاموش می‌شود.`) && act(() => deleteGatewayCredential(storeId, g.gateway), "کد درگاه حذف شد؛ این درگاه خاموش است.")}
          >
            حذف
          </Button>
        )}
      </Box>
      <Typography variant="body2">
        دامنه‌ی ثبت‌شده‌ی درگاه باید این باشد: {domain ? <Box component="span" dir="ltr" sx={{ fontFamily: "monospace", fontWeight: 700 }}>{domain}</Box> : "فروشگاه هنوز نشانی ندارد."}
      </Typography>
    </Paper>
  );
}
