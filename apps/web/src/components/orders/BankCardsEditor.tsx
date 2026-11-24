"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Delete from "@mui/icons-material/Delete";
import { MAX_BANK_CARDS, bankOf, luhnValid } from "@store-builder/shared/modules/orders/card-transfer";
import { digitsToAscii } from "@store-builder/shared/lib/text";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { getBankCards, putBankCards } from "@/client/api";
import { failText } from "./labels";

type Row = { cardNumber: string; holderName: string; bankName: string };
const digits = (v: string) => digitsToAscii(v).replace(/\D/g, "");

/**
 * D35b-1: the store's bank cards for card-to-card payment (at most 5). Shown to a shopper only on their own unpaid card-to-card order.
 * Saving replaces the whole list at once (like shipping methods); it applies immediately, without publishing.
 */
export default function BankCardsEditor({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBankCards(storeId).then(setRows).catch((e) => setError(failText(e)));
  }, [storeId]);

  const set = (i: number, k: keyof Row, v: string) => setRows((r) => r!.map((x, n) => (n === i ? { ...x, [k]: v } : x)));

  async function save() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setRows(await putBankCards(storeId, rows!.map((r) => ({ ...r, cardNumber: digits(r.cardNumber) }))));
      setDone(rows!.length ? "کارت‌ها ذخیره شد. خریداران حالا می‌توانند کارت به کارت پرداخت کنند." : "کارت‌ها حذف شد؛ پرداخت کارت به کارت خاموش است.");
    } catch (e) {
      setError(e instanceof ValidationError ? (Object.values(e.fieldErrors).flat()[0] ?? "اطلاعات کارت‌ها را بررسی کنید.") : failText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return error ? <Alert severity="error">{error}</Alert> : <Typography color="text.secondary">در حال بارگذاری…</Typography>;
  return (
    <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
      <Typography sx={{ fontWeight: 700 }}>کارت به کارت</Typography>
      <Typography variant="body2" color="text.secondary">
        شماره کارت‌هایی که خریدار به آن واریز می‌کند. خریدار پس از واریز، عکس رسید، شماره‌ی پیگیری و ۴ رقم آخر کارتش را می‌فرستد و شما در صفحه‌ی سفارش آن را
        تأیید یا رد می‌کنید. اگر تا ۲۴ ساعت رسیدی نرسد، سفارش منقضی و موجودی آزاد می‌شود.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {done && <Alert severity="success">{done}</Alert>}
      {rows.map((r, i) => {
        const d = digits(r.cardNumber);
        const bad = d.length > 0 && (d.length !== 16 || !luhnValid(d));
        return (
          <Box key={i} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "2fr 1.5fr 1.5fr auto" }, gap: 1, alignItems: "start" }}>
            <TextField
              label="شماره کارت (۱۶ رقم)"
              value={r.cardNumber}
              onChange={(e) => set(i, "cardNumber", e.target.value)}
              onBlur={() => !r.bankName && bankOf(d) && set(i, "bankName", bankOf(d)!)}
              error={bad}
              helperText={bad ? "شماره کارت معتبر نیست" : " "}
              size="small"
              slotProps={{ htmlInput: { dir: "ltr", inputMode: "numeric", maxLength: 23, autoComplete: "off" } }}
            />
            <TextField label="نام صاحب کارت" value={r.holderName} onChange={(e) => set(i, "holderName", e.target.value)} size="small" slotProps={{ htmlInput: { maxLength: 60 } }} helperText=" " />
            <TextField label="بانک" value={r.bankName} onChange={(e) => set(i, "bankName", e.target.value)} size="small" slotProps={{ htmlInput: { maxLength: 40 } }} helperText={bankOf(d) && !r.bankName ? bankOf(d) : " "} />
            <IconButton aria-label={`حذف کارت ${i + 1}`} onClick={() => setRows(rows.filter((_, n) => n !== i))}><Delete /></IconButton>
          </Box>
        );
      })}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Button variant="outlined" disabled={rows.length >= MAX_BANK_CARDS} onClick={() => setRows([...rows, { cardNumber: "", holderName: "", bankName: "" }])}>
          افزودن کارت
        </Button>
        <Button variant="contained" disabled={busy} onClick={save}>{busy ? "در حال ذخیره…" : "ذخیره‌ی کارت‌ها"}</Button>
      </Box>
    </Paper>
  );
}
