"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { quotePurchase } from "@store-builder/shared/modules/billing/billing";
import { getBilling, payPlan, type StoreBillingDto } from "@/client/api";
import { goToGateway } from "@/client/shop";
import { PAYMENT_STATUS_COLORS, PAYMENT_STATUS_LABELS, paymentTitle } from "./paymentLabels";
import { TextLink } from "@/components/NextLinks";
import { date, failText, toman } from "@/components/orders/labels";

const fa = (n: number) => n.toLocaleString("fa-IR");
const day = (iso: string) => new Date(iso).toLocaleDateString("fa-IR", { dateStyle: "medium" });

/** The store's subscription: what is running, the plans on sale (bought here: wallet credit first, the rest through the gateway), and what was paid. */
export default function BillingView({ storeId }: { storeId: string }) {
  const [b, setB] = useState<StoreBillingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ planId: string; useWallet: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const load = useCallback(() => getBilling(storeId).then(setB).catch((e) => setError(failText(e))), [storeId]);
  useEffect(() => {
    let live = true;
    getBilling(storeId).then((r) => live && setB(r)).catch((e) => live && setError(failText(e)));
    return () => {
      live = false;
    };
  }, [storeId]);

  async function pay() {
    if (!choice) return;
    setBusy(true);
    setPayError(null);
    try {
      const r = await payPlan(storeId, choice.planId, choice.useWallet);
      if (r.status === "activated") {
        setNotice(`اشتراک «${r.subscription.planName}» فعال شد.`);
        setChoice(null);
        await load();
        setBusy(false);
        return;
      }
      if (!goToGateway(r.url)) {
        setPayError("نشانی درگاه معتبر نبود؛ دوباره تلاش کنید.");
        setBusy(false);
      }
    } catch (e) {
      setPayError(failText(e));
      setBusy(false);
    }
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!b) return <Skeleton variant="rounded" height={160} />;
  const s = b.state;
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>اشتراک</Typography>
        <Typography variant="body2" color="text.secondary">اشتراک فروشگاه شما و پلن‌های موجود. پلن را همین‌جا می‌خرید یا تمدید می‌کنید؛ اول از اعتبار کیف پول کم می‌شود و بقیه را در درگاه پرداخت می‌کنید.</Typography>
      </Box>

      {notice && <Alert severity="success" role="status" data-testid="pay-notice" onClose={() => setNotice(null)}>{notice}</Alert>}
      {b.openPayment && (
        <Alert severity="warning" data-testid="open-payment">
          یک پرداخت ({paymentTitle(b.openPayment)}، {toman(b.openPayment.amountToman)}) هنوز تمام نشده است. اگر آن را در درگاه کامل کرده‌اید چند دقیقه صبر کنید و صفحه را تازه کنید؛ در غیر این صورت چند دقیقه بعد می‌توانید دوباره تلاش کنید.
          <Button size="small" sx={{ marginInlineStart: 1 }} onClick={() => load()}>تازه‌سازی</Button>
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} data-testid="subscription-card">
        {s.kind === "none" && <Typography>هنوز اشتراکی برای این فروشگاه ثبت نشده است.</Typography>}
        {b.subscription && s.kind !== "none" && (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{b.subscription.planName}</Typography>
              <Chip size="small" color={s.kind === "active" ? "success" : "default"} variant={s.kind === "active" ? "filled" : "outlined"} label={s.kind === "active" ? `فعال · ${fa(s.daysLeft)} روز مانده` : "منقضی شده"} />
            </Stack>
            <Typography variant="body2" color="text.secondary">از {day(b.subscription.startsAt)} تا {day(b.subscription.endsAt)}</Typography>
          </Stack>
        )}
        {b.referralDiscountPercent > 0 && (
          <Alert severity="success" sx={{ mt: 2 }} data-testid="invite-discount">
            شما با کد معرف دعوت شده‌اید: اولین خرید اشتراک شما {fa(b.referralDiscountPercent)}٪ تخفیف دارد (خودکار اعمال می‌شود).
          </Alert>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} data-testid="limits-card" component="section" aria-labelledby="limits-h">
        <Typography id="limits-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 0.5 }}>سقف‌های فروشگاه شما</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {b.free ? "اشتراک فعالی ندارید؛ سقف‌های رایگان اعمال می‌شود. کالاها و همکاران موجود حذف نمی‌شوند، فقط افزودن تازه از سقف می‌گذرد." : "سقف‌های پلن فعلی شما."}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 1, sm: 4 }}>
          <Typography>محصولات: <strong>{fa(b.usage.products)}</strong> از {fa(b.limits.maxProducts)}</Typography>
          <Typography>همکاران و دعوت‌ها: <strong>{fa(b.usage.staff)}</strong> از {fa(b.limits.maxStaff)}</Typography>
        </Stack>
      </Paper>

      <Box component="section" aria-labelledby="plans-h">
        <Typography id="plans-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1 }}>پلن‌های موجود</Typography>
        {b.plans.length === 0 && <Typography color="text.secondary">فعلاً پلنی برای فروش تعریف نشده است.</Typography>}
        <Box component="ul" aria-label="پلن‌ها" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(auto-fill, minmax(260px, 1fr))" } }}>
          {b.plans.map((p) => (
            <Paper key={p.id} component="li" variant="outlined" data-testid="plan-card" sx={{ p: 2 }}>
              <Typography sx={{ fontWeight: 700 }}>{p.name}</Typography>
              <Typography variant="h6" component="p">{p.priceToman === 0 ? "رایگان" : toman(p.priceToman)}</Typography>
              <Typography variant="body2" color="text.secondary">برای {fa(p.durationDays)} روز · تا {fa(p.maxProducts)} محصول · {fa(p.maxStaff)} همکار</Typography>
              {p.description && <Typography variant="body2" sx={{ mt: 1, overflowWrap: "anywhere" }}>{p.description}</Typography>}
              <Button variant={choice?.planId === p.id ? "contained" : "outlined"} sx={{ mt: 1.5 }} onClick={() => { setChoice({ planId: p.id, useWallet: b.walletToman > 0 }); setPayError(null); setNotice(null); }} aria-label={`خرید پلن ${p.name}`} aria-pressed={choice?.planId === p.id}>
                {s.kind === "active" ? "تمدید یا تغییر" : "خرید"}
              </Button>
            </Paper>
          ))}
        </Box>
        {choice && (() => {
          const plan = b.plans.find((x) => x.id === choice.planId);
          if (!plan) return null;
          const q = quotePurchase({ price: plan.priceToman, invited: b.referralDiscountPercent > 0, walletBalance: b.walletToman, useWallet: choice.useWallet });
          const blocked = q.cash > 0 && !b.gatewayReady;
          return (
            <Paper variant="outlined" sx={{ p: 2, mt: 1.5 }} component="section" aria-labelledby="checkout-h" data-testid="plan-checkout">
              <Typography id="checkout-h" variant="subtitle1" component="h4" sx={{ fontWeight: 700, mb: 1 }}>پرداخت پلن «{plan.name}»</Typography>
              <Stack spacing={0.5} sx={{ mb: 1 }}>
                <Typography variant="body2">قیمت: {toman(q.price)}</Typography>
                {q.discount > 0 && <Typography variant="body2">تخفیف دعوت ({fa(b.referralDiscountPercent)}٪): {toman(q.discount)}</Typography>}
                {q.walletUsed > 0 && <Typography variant="body2">از کیف پول: {toman(q.walletUsed)}</Typography>}
                <Typography sx={{ fontWeight: 700 }} data-testid="checkout-cash">{q.cash > 0 ? `پرداخت از درگاه: ${toman(q.cash)}` : "پرداخت کامل از کیف پول"}</Typography>
              </Stack>
              {b.walletToman > 0 && (
                <FormControlLabel control={<Checkbox checked={choice.useWallet} onChange={(e) => setChoice({ ...choice, useWallet: e.target.checked })} />} label={`استفاده از اعتبار کیف پول (موجودی ${toman(b.walletToman)})`} />
              )}
              {blocked && <Alert severity="info" sx={{ my: 1 }}>پرداخت آنلاین فعلاً در دسترس نیست. با اعتبار کیف پول می‌توانید بخرید یا با پشتیبانی تماس بگیرید.</Alert>}
              {payError && <Alert severity="error" role="alert" sx={{ my: 1 }}>{payError}</Alert>}
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button variant="contained" onClick={pay} disabled={busy || blocked || !!b.openPayment}>{q.cash > 0 ? "رفتن به درگاه پرداخت" : "فعال‌سازی اشتراک"}</Button>
                <Button onClick={() => setChoice(null)} disabled={busy}>انصراف</Button>
              </Stack>
            </Paper>
          );
        })()}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          برای شارژ کیف پول به صفحهٔ <TextLink href={`/dashboard/stores/${storeId}/wallet`} underline="always">کیف پول</TextLink> بروید. اگر در پرداخت مشکلی داشتید از <TextLink href={`/dashboard/stores/${storeId}/tickets`} underline="always">درخواست پشتیبانی</TextLink> کمک بگیرید.
        </Typography>
      </Box>

      {b.payments.length > 0 && (
        <Box component="section" aria-labelledby="payments-h">
          <Typography id="payments-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1 }}>پرداخت‌های درگاه</Typography>
          <Paper variant="outlined" sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label="پرداخت‌های درگاه">
              <TableHead>
                <TableRow>
                  <TableCell scope="col">تاریخ</TableCell>
                  <TableCell scope="col">بابت</TableCell>
                  <TableCell scope="col">مبلغ</TableCell>
                  <TableCell scope="col">وضعیت</TableCell>
                  <TableCell scope="col">کد پیگیری</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {b.payments.map((p) => (
                  <TableRow key={p.id} data-testid="payment-row">
                    <TableCell component="th" scope="row">{date(p.createdAt)}</TableCell>
                    <TableCell>{paymentTitle(p)}</TableCell>
                    <TableCell>{toman(p.amountToman)}</TableCell>
                    <TableCell><Chip size="small" color={PAYMENT_STATUS_COLORS[p.status]} variant={p.status === "PAID" ? "filled" : "outlined"} label={PAYMENT_STATUS_LABELS[p.status]} /></TableCell>
                    <TableCell dir="ltr" sx={{ textAlign: "right" }}>{p.refId ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Box>
      )}

      <Box component="section" aria-labelledby="purchases-h">
        <Typography id="purchases-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1 }}>خریدهای ثبت‌شده</Typography>
        {b.purchases.length === 0 ? (
          <Typography color="text.secondary">هنوز خریدی ثبت نشده است.</Typography>
        ) : (
          <Paper variant="outlined" sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label="خریدهای ثبت‌شده">
              <TableHead>
                <TableRow>
                  <TableCell scope="col">تاریخ</TableCell>
                  <TableCell scope="col">پلن</TableCell>
                  <TableCell scope="col">قیمت</TableCell>
                  <TableCell scope="col">تخفیف</TableCell>
                  <TableCell scope="col">از کیف پول</TableCell>
                  <TableCell scope="col">پرداخت‌شده</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {b.purchases.map((p) => (
                  <TableRow key={p.id} data-testid="purchase-row">
                    <TableCell component="th" scope="row">{date(p.createdAt)}</TableCell>
                    <TableCell>{p.planName}</TableCell>
                    <TableCell>{toman(p.priceToman)}</TableCell>
                    <TableCell>{p.discountToman ? toman(p.discountToman) : "—"}</TableCell>
                    <TableCell>{p.walletUsedToman ? toman(p.walletUsedToman) : "—"}</TableCell>
                    <TableCell>{toman(p.cashToman)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
      </Box>
    </Stack>
  );
}
