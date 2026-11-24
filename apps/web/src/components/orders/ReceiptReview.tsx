"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { RECEIPT_STATUS_LABELS } from "@store-builder/shared/modules/orders/card-transfer";
import { getReceipts, receiptImageUrl, reviewReceipt, type OrderDto, type Receipt } from "@/client/api";
import { date, failText, toman } from "./labels";

const COLOR = { SUBMITTED: "warning", APPROVED: "success", REJECTED: "default" } as const;

/**
 * D35b-1: the shopper's card-to-card receipts on the merchant's order page. Compare the image, the tracking number and the last 4 digits
 * with the bank statement, then approve (the order is placed) or reject with a reason the shopper will see.
 */
export default function ReceiptReview({ storeId, order, onOrder }: { storeId: string; order: OrderDto; onOrder: (o: OrderDto) => void }) {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getReceipts(storeId, order.id).then(setReceipts).catch((e) => setError(failText(e))), [storeId, order.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(r: Receipt, decision: "approve" | "reject") {
    if (decision === "approve" && !window.confirm(`واریز ${toman(order.total)} را در حساب بانکی خود دیده‌اید؟ با تأیید، سفارش ثبت می‌شود.`)) return;
    setBusy(true);
    setError(null);
    try {
      const out = await reviewReceipt(storeId, order.id, r.id, decision, reason);
      onOrder(out.order);
      setReason("");
      await load();
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!receipts) return error ? <Alert severity="error">{error}</Alert> : null;
  return (
    <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
      <Typography sx={{ fontWeight: 700 }}>رسیدهای کارت به کارت</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {receipts.length === 0 && (
        <Typography color="text.secondary">
          {order.status === "AWAITING_PAYMENT" ? `خریدار هنوز رسیدی نفرستاده است${order.paymentDeadline ? ` (مهلت تا ${date(order.paymentDeadline)})` : ""}.` : "رسیدی ثبت نشده است."}
        </Typography>
      )}
      {receipts.map((r) => (
        <Box key={r.id} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "180px 1fr" }, gap: 2, borderTop: 1, borderColor: "divider", pt: 1.5 }}>
          <a href={receiptImageUrl(storeId, order.id, r.id)} target="_blank" rel="noopener noreferrer" aria-label="تصویر رسید در اندازه‌ی کامل">
            {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated image: not for the image optimizer */}
            <img src={receiptImageUrl(storeId, order.id, r.id)} alt="تصویر رسید خریدار" style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 8, background: "#f5f5f5" }} />
          </a>
          <Box sx={{ display: "grid", gap: 0.75, alignContent: "start" }}>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
              <Chip size="small" color={COLOR[r.status]} label={RECEIPT_STATUS_LABELS[r.status]} />
              <Typography variant="body2" color="text.secondary">{date(r.createdAt)}</Typography>
            </Box>
            <Typography>مبلغ سفارش: <strong>{toman(order.total)}</strong></Typography>
            <Typography>شماره‌ی پیگیری: <span dir="ltr">{r.trackingCode}</span></Typography>
            <Typography>۴ رقم آخر کارت پرداخت‌کننده: <span dir="ltr">{r.payerCardLast4}</span></Typography>
            {r.status === "REJECTED" && <Typography color="text.secondary">دلیل رد: {r.reviewNote}</Typography>}
            {r.status === "SUBMITTED" && order.status === "AWAITING_PAYMENT" && (
              <Box sx={{ display: "grid", gap: 1, mt: 1 }}>
                <TextField label="دلیل رد (به خریدار نمایش داده می‌شود)" value={reason} onChange={(e) => setReason(e.target.value)} size="small" slotProps={{ htmlInput: { maxLength: 300 } }} />
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Button variant="contained" color="success" disabled={busy} onClick={() => decide(r, "approve")}>تأیید واریز و ثبت سفارش</Button>
                  <Button variant="outlined" color="error" disabled={busy || reason.trim().length < 3} onClick={() => decide(r, "reject")}>رد رسید</Button>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      ))}
    </Paper>
  );
}
