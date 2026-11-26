"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { GATEWAY_LABELS, nextStatuses, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, type OrderStatus } from "@store-builder/shared/modules/orders/orders";
import { provinceName } from "@store-builder/shared/modules/checkout/provinces";
import { formatIranMobile } from "@store-builder/shared/lib/phone";
import { changeOrderStatus, setOrderTracking, getOrder, getOrderPayments, type OrderDto, type PaymentAttempt } from "@/client/api";
import ReceiptReview from "./ReceiptReview";
import { ACTION_LABEL, ORDER_STATUS_LABELS, STATUS_COLOR, date, failText, toman } from "./labels";

/** One order for the merchant (phase 3.4): items, delivery, history and the next steps (cancelling gives the stock back). */
export default function OrderDetail({ storeId, orderId }: { storeId: string; orderId: string }) {
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [note, setNote] = useState("");
  // The carrier's code: typed when shipping (optional), and editable afterwards while the order is shipped or delivered.
  const [shipCode, setShipCode] = useState("");
  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const [codeSaved, setCodeSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState<PaymentAttempt[]>([]);

  useEffect(() => {
    getOrder(storeId, orderId).then((o) => {
      setOrder(o);
      if (o.paymentMethod === "ONLINE") getOrderPayments(storeId, orderId).then(setAttempts).catch(() => undefined);
    }).catch((e) => setError(failText(e)));
  }, [storeId, orderId]);

  async function move(to: OrderStatus) {
    const paidOnline = order?.paymentMethod === "ONLINE" && order.payment !== null;
    const paidTransfer = order?.paymentMethod === "CARD_TRANSFER" && order.status !== "AWAITING_PAYMENT";
    const ask = paidOnline
      ? "این سفارش آنلاین پرداخت شده است. با لغو، موجودی برمی‌گردد اما مبلغ خودکار برگردانده نمی‌شود: آن را خودتان از پنل درگاه به خریدار برگردانید. لغو شود؟"
      : paidTransfer
      ? "واریز کارت به کارت این سفارش تأیید شده است. با لغو، موجودی برمی‌گردد؛ مبلغ را خودتان به حساب خریدار برگردانید. لغو شود؟"
      : "سفارش لغو شود؟ موجودی کالاها برمی‌گردد.";
    if (to === "CANCELLED" && !window.confirm(ask)) return;
    setBusy(true);
    setError(null);
    try {
      setOrder(await changeOrderStatus(storeId, orderId, to, note, to === "SHIPPED" ? shipCode : undefined));
      setNote("");
      setShipCode("");
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveTracking(code: string) {
    setBusy(true);
    setError(null);
    setCodeSaved(false);
    try {
      setOrder(await setOrderTracking(storeId, orderId, code));
      setCodeDraft(null);
      setCodeSaved(true);
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!order) return error ? <Alert severity="error">{error}</Alert> : <Typography color="text.secondary">در حال بارگذاری…</Typography>;
  const steps = nextStatuses("MERCHANT", order.status);
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 800 }}>سفارش #{order.number.toLocaleString("fa-IR")}</Typography>
        <Chip color={STATUS_COLOR[order.status]} label={ORDER_STATUS_LABELS[order.status]} />
        <Typography variant="body2" color="text.secondary">{date(order.createdAt)} — {PAYMENT_METHOD_LABELS[order.paymentMethod]}{order.paymentGateway ? ` (${GATEWAY_LABELS[order.paymentGateway]})` : ""}</Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}

      {steps.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
          <TextField label="یادداشت (اختیاری، در تاریخچه ثبت می‌شود)" value={note} onChange={(e) => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} size="small" />
          {steps.includes("SHIPPED") && (
            <TextField
              label="کد رهگیری مرسوله (اختیاری)"
              value={shipCode}
              onChange={(e) => setShipCode(e.target.value)}
              size="small"
              helperText="اگر کد پست یا باربری دارید اینجا بنویسید؛ خریدار آن را در صفحهٔ پیگیری سفارش می‌بیند. بعداً هم می‌توانید ثبت یا اصلاحش کنید."
              slotProps={{ htmlInput: { maxLength: 80, dir: "ltr" } }}
            />
          )}
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {steps.map((to) => (
              <Button key={to} variant={to === "CANCELLED" ? "outlined" : "contained"} color={to === "CANCELLED" ? "error" : "primary"} onClick={() => move(to)} disabled={busy}>
                {ACTION_LABEL[to]}
              </Button>
            ))}
          </Box>
        </Paper>
      )}

      {(order.status === "SHIPPED" || order.status === "DELIVERED") && (
        <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1 }} data-testid="order-tracking">
          <Typography sx={{ fontWeight: 700 }}>کد رهگیری مرسوله</Typography>
          {codeDraft === null ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              {order.trackingCode ? <Typography>کد: <strong dir="ltr">{order.trackingCode}</strong></Typography> : <Typography color="text.secondary">هنوز کد رهگیری ثبت نشده است.</Typography>}
              <Button size="small" onClick={() => { setCodeDraft(order.trackingCode ?? ""); setCodeSaved(false); }}>{order.trackingCode ? "اصلاح کد" : "ثبت کد رهگیری"}</Button>
              {codeSaved && <Typography variant="body2" color="success.main" role="status">ذخیره شد.</Typography>}
            </Box>
          ) : (
            <Box component="form" onSubmit={(e) => { e.preventDefault(); void saveTracking(codeDraft); }} sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "flex-start" }}>
              <TextField label="کد رهگیری" value={codeDraft} onChange={(e) => setCodeDraft(e.target.value)} size="small" helperText="خالی بگذارید تا کد پاک شود." slotProps={{ htmlInput: { maxLength: 80, dir: "ltr" } }} />
              <Button type="submit" variant="contained" size="small" disabled={busy} sx={{ height: 40 }}>ذخیره</Button>
              <Button size="small" onClick={() => setCodeDraft(null)} sx={{ height: 40 }}>انصراف</Button>
            </Box>
          )}
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1 }}>
        <Typography sx={{ fontWeight: 700 }}>کالاها</Typography>
        {order.items.map((i, n) => (
          <Box key={n} sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
            <span>{i.name}{i.variantLabel ? ` — ${i.variantLabel}` : ""} × {i.quantity.toLocaleString("fa-IR")}</span>
            <span style={{ whiteSpace: "nowrap" }}>{toman(i.lineTotal)}</span>
          </Box>
        ))}
        <Divider />
        <Box sx={{ display: "flex", justifyContent: "space-between" }}><span>جمع کالاها</span><span>{toman(order.subtotal)}</span></Box>
        <Box sx={{ display: "flex", justifyContent: "space-between" }}><span>ارسال ({order.shipping.name})</span><span>{order.shipping.cost === 0 ? "رایگان" : toman(order.shipping.cost)}</span></Box>
        {order.codFee > 0 && <Box sx={{ display: "flex", justifyContent: "space-between" }}><span>کارمزد پرداخت در محل</span><span>{toman(order.codFee)}</span></Box>}
        {order.discountAmount > 0 && <Box sx={{ display: "flex", justifyContent: "space-between" }}><span>تخفیف (<span dir="ltr">{order.discountCode}</span>)</span><span>− {toman(order.discountAmount)}</span></Box>}
        <Box sx={{ display: "flex", justifyContent: "space-between", fontWeight: 800 }}><span>مبلغ کل</span><span>{toman(order.total)}</span></Box>
      </Paper>

      {order.paymentMethod === "CARD_TRANSFER" && <ReceiptReview storeId={storeId} order={order} onOrder={setOrder} />}

      {order.paymentMethod === "ONLINE" && (
        <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 0.5 }}>
          <Typography sx={{ fontWeight: 700 }}>پرداخت اینترنتی</Typography>
          {order.payment ? (
            <Typography>پرداخت‌شده در {date(order.payment.paidAt)} — کد پیگیری <span dir="ltr">{order.payment.refId}</span>{order.payment.cardPan ? <> — کارت <span dir="ltr">{order.payment.cardPan}</span></> : null}</Typography>
          ) : order.status === "AWAITING_PAYMENT" && order.paymentDeadline ? (
            <Typography color="text.secondary">هنوز پرداخت نشده؛ مهلت پرداخت تا {date(order.paymentDeadline)}. پس از آن سفارش منقضی و موجودی آزاد می‌شود.</Typography>
          ) : (
            <Typography color="text.secondary">پرداختی تأیید نشده است.</Typography>
          )}
          {attempts.some((a) => a.status === "REFUND_REQUIRED") && (
            <Alert severity="warning">
              یک پرداخت روی این سفارش تأیید شد در حالی که سفارش دیگر قابل پرداخت نبود (کد پیگیری: {attempts.filter((a) => a.status === "REFUND_REQUIRED").map((a) => a.refId).join("، ")}). مبلغ آن را از پنل زرین‌پال به خریدار برگردانید.
            </Alert>
          )}
          {attempts.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              تلاش‌ها: {attempts.map((a) => `${date(a.createdAt)} (${PAYMENT_STATUS_LABELS[a.status]})`).join("، ")}
            </Typography>
          )}
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 0.5 }}>
        <Typography sx={{ fontWeight: 700 }}>تحویل</Typography>
        <Typography>{order.address.recipientName} — <span dir="ltr">{formatIranMobile(order.address.phone)}</span></Typography>
        <Typography>{provinceName(order.address.province) ?? order.address.province}، {order.address.city}، {order.address.line}</Typography>
        <Typography color="text.secondary">کد پستی: {order.address.postalCode}</Typography>
        {order.note && <Typography>یادداشت خریدار: {order.note}</Typography>}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 0.5 }}>
        <Typography sx={{ fontWeight: 700 }}>تاریخچه</Typography>
        {order.history.map((h, n) => (
          <Typography key={n} variant="body2">
            {date(h.at)} — {ORDER_STATUS_LABELS[h.to]} ({h.actor === "MERCHANT" ? "فروشگاه" : h.actor === "CUSTOMER" ? "خریدار" : "سیستم"}){h.note ? ` — ${h.note}` : ""}
          </Typography>
        ))}
      </Paper>
    </Box>
  );
}
