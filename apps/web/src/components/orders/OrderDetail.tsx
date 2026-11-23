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
import { nextStatuses, PAYMENT_METHOD_LABELS, type OrderStatus } from "@store-builder/shared/modules/orders/orders";
import { provinceName } from "@store-builder/shared/modules/checkout/provinces";
import { formatIranMobile } from "@store-builder/shared/lib/phone";
import { changeOrderStatus, getOrder, type OrderDto } from "@/client/api";
import { ACTION_LABEL, ORDER_STATUS_LABELS, STATUS_COLOR, date, failText, toman } from "./labels";

/** One order for the merchant (phase 3.4): items, delivery, history and the next steps (cancelling gives the stock back). */
export default function OrderDetail({ storeId, orderId }: { storeId: string; orderId: string }) {
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getOrder(storeId, orderId).then(setOrder).catch((e) => setError(failText(e)));
  }, [storeId, orderId]);

  async function move(to: OrderStatus) {
    if (to === "CANCELLED" && !window.confirm("سفارش لغو شود؟ موجودی کالاها برمی‌گردد.")) return;
    setBusy(true);
    setError(null);
    try {
      setOrder(await changeOrderStatus(storeId, orderId, to, note));
      setNote("");
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
        <Typography variant="body2" color="text.secondary">{date(order.createdAt)} — {PAYMENT_METHOD_LABELS[order.paymentMethod]}</Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}

      {steps.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
          <TextField label="یادداشت (اختیاری، در تاریخچه ثبت می‌شود)" value={note} onChange={(e) => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} size="small" />
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {steps.map((to) => (
              <Button key={to} variant={to === "CANCELLED" ? "outlined" : "contained"} color={to === "CANCELLED" ? "error" : "primary"} onClick={() => move(to)} disabled={busy}>
                {ACTION_LABEL[to]}
              </Button>
            ))}
          </Box>
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
        <Box sx={{ display: "flex", justifyContent: "space-between", fontWeight: 800 }}><span>مبلغ کل</span><span>{toman(order.total)}</span></Box>
      </Paper>

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
