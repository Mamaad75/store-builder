"use client";

import { useState } from "react";
import CheckRounded from "@mui/icons-material/CheckRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import EditOutlined from "@mui/icons-material/EditOutlined";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { updateProduct } from "@/client/api";
import { refresh } from "@/client/nav";
import { failText } from "@/components/orders/labels";
import { MAX_PRICE_TOMAN, formatToman } from "@store-builder/shared/lib/money";
import { parseScaled } from "./price-link-form";

type Field = "price" | "stockQuantity";
const LABEL: Record<Field, string> = { price: "قیمت", stockQuantity: "موجودی" };

/**
 * One number of a product that can be changed right in the list (price in toman, or stock): a pencil opens a small field, Enter or the tick
 * saves, Escape or the cross cancels. Only the changed field is sent. When something else owns the number (variants, a price linked to
 * the dollar or gold) there is no pencil, only the reason. The API checks everything again.
 */
export default function QuickEdit({ storeId, productId, productName, field, value, lockedReason }: { storeId: string; productId: string; productName: string; field: Field; value: number; lockedReason?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = field === "price" ? formatToman(value) : value.toLocaleString("fa-IR");

  async function save() {
    const n = parseScaled(draft, 0);
    if (n === null || (field === "price" && n > MAX_PRICE_TOMAN)) {
      setError(field === "price" ? "قیمت را به تومان و به‌صورت عدد صحیح وارد کنید." : "موجودی را به‌صورت عدد صحیح وارد کنید.");
      return;
    }
    if (n === value) return setEditing(false);
    setBusy(true);
    setError(null);
    try {
      await updateProduct(storeId, productId, { [field]: n });
      setEditing(false);
      refresh();
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }
  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  if (!editing) {
    return (
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
        <span>{shown}</span>
        {lockedReason ? (
          <Typography component="span" variant="caption" color="text.secondary" data-testid={`locked-${field}`}>({lockedReason})</Typography>
        ) : (
          <IconButton size="small" aria-label={`ویرایش سریع ${LABEL[field]} «${productName}»`} onClick={() => { setDraft(String(value)); setEditing(true); }}>
            <EditOutlined fontSize="inherit" />
          </IconButton>
        )}
      </Box>
    );
  }
  return (
    <Box component="form" onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => e.key === "Escape" && cancel()} sx={{ display: "inline-flex", alignItems: "flex-start", gap: 0.5 }}>
      <TextField
        size="small"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        error={!!error}
        helperText={error ?? " "}
        sx={{ width: field === "price" ? 140 : 90 }}
        slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr", "aria-label": `${LABEL[field]} «${productName}»` } }}
      />
      <IconButton type="submit" size="small" color="primary" disabled={busy} aria-label={`ذخیرهٔ ${LABEL[field]} «${productName}»`}><CheckRounded fontSize="small" /></IconButton>
      <IconButton size="small" onClick={cancel} aria-label="انصراف"><CloseRounded fontSize="small" /></IconButton>
    </Box>
  );
}
