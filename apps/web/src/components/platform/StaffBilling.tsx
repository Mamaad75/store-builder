"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { quotePurchase, WALLET_KIND_LABELS } from "@store-builder/shared/modules/billing/billing";
import { adjustWallet, getStoreBilling, recordPurchase, type PurchaseResult, type StaffStoreBilling } from "@/client/platform-api";
import { TextLink } from "@/components/NextLinks";
import { date, toman } from "@/components/orders/labels";

const fa = (n: number) => n.toLocaleString("fa-IR");
const firstError = (e: unknown) => (e instanceof Error && e.name === "ValidationError" ? (Object.values((e as Error & { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {}).flat()[0] ?? "مقدارها را بررسی کنید.") : e instanceof Error && e.name === "NotFoundError" ? "پیدا نشد." : "انجام نشد؛ دوباره تلاش کنید.");

/** One store's money for the platform staff: the subscription, the wallet and its ledger, the invitation; record a purchase (after receiving the money) and adjust the wallet. */
export default function StaffBilling({ storeId }: { storeId: string }) {
  const [v, setV] = useState<StaffStoreBilling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planId, setPlanId] = useState("");
  const [useWallet, setUseWallet] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [adjMsg, setAdjMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getStoreBilling(storeId).then((r) => { setV(r); setPlanId((p) => p || r.plans[0]?.id || ""); }).catch((e) => setError(e instanceof Error && e.name === "NotFoundError" ? "این فروشگاه پیدا نشد." : "بارگذاری ممکن نشد.")), [storeId]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!v) return <Skeleton variant="rounded" height={200} />;
  const plan = v.plans.find((p) => p.id === planId);
  // The preview is the same pure calculation the server runs under the wallet's lock; the server's answer is what counts.
  const preview = plan ? quotePurchase({ price: plan.priceToman, invited: v.referredBy?.status === "PENDING", walletBalance: v.wallet.balanceToman, useWallet }) : null;

  async function buy(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setBuyError(null);
    setResult(null);
    try {
      setResult(await recordPurchase(storeId, { planId, useWallet, note }));
      setNote("");
      await load();
    } catch (err) {
      setBuyError(firstError(err));
    } finally {
      setBusy(false);
    }
  }
  async function adjust(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setAdjMsg(null);
    try {
      const r = await adjustWallet(storeId, { amountToman: /^-?\d+$/.test(amount.trim()) ? Number(amount.trim()) : NaN, reason });
      setAdjMsg({ ok: true, text: `ثبت شد؛ موجودی اکنون ${toman(r.balanceToman)} است.` });
      setAmount("");
      setReason("");
      await load();
    } catch (err) {
      setAdjMsg({ ok: false, text: firstError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={3}>
      <TextLink href="/platform/stores" underline="hover">→ فروشگاه‌ها</TextLink>
      <Box>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>مالی «{v.storeName}»</Typography>
        <Typography color="text.secondary" data-testid="staff-state">
          {v.state.kind === "none" ? "اشتراکی ثبت نشده است." : v.state.kind === "active" ? `${v.subscription?.planName} · ${fa(v.state.daysLeft)} روز مانده` : `${v.subscription?.planName} · منقضی شده`}
          {" · "}موجودی کیف پول: <span data-testid="staff-balance">{toman(v.wallet.balanceToman)}</span>
          {v.referredBy ? ` · ${v.referredBy.status === "PENDING" ? "با کد معرف آمده (تخفیف اولین خرید در انتظار)" : "با کد معرف آمده (تخفیف مصرف شده)"}` : ""}
        </Typography>
      </Box>

      <Paper variant="outlined" component="form" onSubmit={buy} noValidate sx={{ p: 2 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1 }}>ثبت خرید اشتراک</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>فقط پس از دریافت مبلغ ثبت کنید. تخفیف دعوت و پاداش دعوت‌کننده خودکار حساب می‌شود.</Typography>
        {buyError && <Alert severity="error" role="alert" sx={{ mb: 1.5 }}>{buyError}</Alert>}
        {result && (
          <Alert severity="success" role="status" sx={{ mb: 1.5 }} data-testid="purchase-result">
            ثبت شد: قیمت {toman(result.quote.price)}{result.quote.discount ? `، تخفیف دعوت ${toman(result.quote.discount)}` : ""}{result.quote.walletUsed ? `، از کیف پول ${toman(result.quote.walletUsed)}` : ""}؛ <strong>مبلغ دریافتی: {toman(result.quote.cash)}</strong>.{result.quote.reward ? ` پاداش دعوت‌کننده: ${toman(result.quote.reward)}.` : ""}
          </Alert>
        )}
        <Stack spacing={2}>
          <TextField select label="پلن" value={planId} onChange={(e) => setPlanId(e.target.value)} sx={{ maxWidth: 360 }} disabled={v.plans.length === 0} helperText={v.plans.length === 0 ? "پلن فعالی نیست؛ اول در «پلن‌ها» بسازید." : undefined}>
            {v.plans.map((p) => <MenuItem key={p.id} value={p.id}>{p.name} — {p.priceToman === 0 ? "رایگان" : toman(p.priceToman)} / {fa(p.durationDays)} روز</MenuItem>)}
          </TextField>
          <FormControlLabel control={<Checkbox checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} />} label={`خرج کردن اعتبار کیف پول (${toman(v.wallet.balanceToman)})`} />
          <TextField label="یادداشت (شمارهٔ پیگیری پرداخت…)" value={note} onChange={(e) => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
          {preview && (
            <Typography variant="body2" data-testid="purchase-preview">
              پیش‌بینی: قیمت {toman(preview.price)}{preview.discount ? ` − تخفیف دعوت ${toman(preview.discount)}` : ""}{preview.walletUsed ? ` − کیف پول ${toman(preview.walletUsed)}` : ""} = <strong>دریافت {toman(preview.cash)}</strong>
            </Typography>
          )}
          <Box><Button type="submit" variant="contained" disabled={busy || !planId}>ثبت خرید</Button></Box>
        </Stack>
      </Paper>

      <Paper variant="outlined" component="form" onSubmit={adjust} noValidate sx={{ p: 2 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1.5 }}>تنظیم اعتبار کیف پول</Typography>
        {adjMsg && <Alert severity={adjMsg.ok ? "success" : "error"} role={adjMsg.ok ? "status" : "alert"} sx={{ mb: 1.5 }}>{adjMsg.text}</Alert>}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
          <TextField label="مبلغ (تومان؛ منفی = کاهش)" value={amount} onChange={(e) => setAmount(e.target.value)} slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }} />
          <TextField label="دلیل" value={reason} onChange={(e) => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} sx={{ flex: 1 }} />
          <Button type="submit" variant="outlined" disabled={busy || !amount.trim() || !reason.trim()} sx={{ mt: { sm: 0.5 } }}>ثبت</Button>
        </Stack>
      </Paper>

      <Box component="section" aria-labelledby="ledger-staff-h">
        <Typography id="ledger-staff-h" variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1 }}>تراکنش‌های کیف پول</Typography>
        {v.wallet.entries.length === 0 ? <Typography color="text.secondary">تراکنشی نیست.</Typography> : (
          <Box component="ul" aria-label="تراکنش‌ها" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 0.5 }}>
            {v.wallet.entries.map((e) => (
              <Typography key={e.id} component="li" variant="body2" data-testid="staff-ledger-row">{date(e.createdAt)} · {WALLET_KIND_LABELS[e.kind]}{e.note ? ` — ${e.note}` : ""} · <bdi>{e.amountToman > 0 ? "+" : "−"}{toman(Math.abs(e.amountToman))}</bdi> · موجودی {toman(e.balanceAfter)}</Typography>
            ))}
          </Box>
        )}
      </Box>

      <Box component="section" aria-labelledby="purchases-staff-h">
        <Typography id="purchases-staff-h" variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1 }}>خریدهای ثبت‌شده</Typography>
        {v.purchases.length === 0 ? <Typography color="text.secondary">خریدی ثبت نشده است.</Typography> : (
          <Box component="ul" aria-label="خریدها" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 0.5 }}>
            {v.purchases.map((p) => <Typography key={p.id} component="li" variant="body2">{date(p.createdAt)} · {p.planName} · قیمت {toman(p.priceToman)} · دریافتی {toman(p.cashToman)}{p.note ? ` · ${p.note}` : ""}</Typography>)}
          </Box>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary">کد معرف این فروشگاه: <bdi dir="ltr">{v.code}</bdi> · فروشگاه‌های دعوت‌شده: {fa(v.referrals.length)}</Typography>
    </Stack>
  );
}
