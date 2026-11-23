"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteIcon from "@mui/icons-material/Delete";
import { MAX_SHIPPING_METHODS, SHIPPING_KIND_LABELS, SHIPPING_KINDS, type ShippingKind } from "@store-builder/shared/modules/checkout/checkout";
import { PROVINCES } from "@store-builder/shared/modules/checkout/provinces";
import { listShippingMethods, replaceShippingMethods, type ShippingMethodDto } from "@/client/api";
import { failText } from "./labels";

type Method = Omit<ShippingMethodDto, "id">;
const blank = (): Method => ({
  name: "", kind: "FLAT", enabled: true, description: "", price: 0, perKg: 0, defaultItemGrams: 500, provinces: [], provincePrices: [], freeAbove: null,
  cashOnDelivery: { enabled: false, provinces: [], fee: 0 },
});
const withoutId = (m: ShippingMethodDto): Method => {
  const copy: Partial<ShippingMethodDto> = { ...m };
  delete copy.id;
  return copy as Method;
};
const PROVINCE_OPTIONS = PROVINCES.map((p) => p.code);
const pname = (code: string) => PROVINCES.find((p) => p.code === code)?.name ?? code;
const int = (v: string) => {
  const n = Number(v.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function Provinces({ label, value, onChange, help }: { label: string; value: string[]; onChange: (v: string[]) => void; help: string }) {
  return (
    <Autocomplete multiple options={PROVINCE_OPTIONS} value={value} onChange={(_, v) => onChange(v)} getOptionLabel={pname} filterSelectedOptions
      renderInput={(p) => <TextField {...p} label={label} helperText={help} size="small" />} />
  );
}

/**
 * The store's shipping methods (phase 3.3): fixed price, by weight or pickup; where each is offered, a different price per province, free
 * above an amount, and cash on delivery (where, and its fee). Saving replaces the whole list and applies to checkout at once.
 */
export default function ShippingMethodsEditor({ storeId }: { storeId: string }) {
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listShippingMethods(storeId).then((m) => setMethods(m.map(withoutId))).catch((e) => setError(failText(e)));
  }, [storeId]);

  const update = (i: number, patch: Partial<Method>) => {
    setSaved(false);
    setMethods((ms) => ms!.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  };

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const out = await replaceShippingMethods(storeId, methods!);
      setMethods(out.map(withoutId));
      setSaved(true);
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!methods) return error ? <Alert severity="error">{error}</Alert> : <Typography color="text.secondary">در حال بارگذاری…</Typography>;
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      {methods.length === 0 && <Alert severity="info">هنوز روش ارسالی تعریف نشده است؛ بدون روش ارسال، خریداران نمی‌توانند سفارش ثبت کنند.</Alert>}
      {methods.map((m, i) => (
        <Paper key={i} variant="outlined" sx={{ p: 2, display: "grid", gap: 2 }}>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Typography sx={{ fontWeight: 700, flex: 1 }}>روش ارسال {(i + 1).toLocaleString("fa-IR")}</Typography>
            <FormControlLabel control={<Switch checked={m.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />} label="فعال" />
            <IconButton aria-label="حذف این روش" onClick={() => setMethods(methods.filter((_, j) => j !== i))}><DeleteIcon /></IconButton>
          </Box>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
            <TextField label="نام (مثلاً پست پیشتاز، پیک)" value={m.name} onChange={(e) => update(i, { name: e.target.value })} size="small" required />
            <TextField select label="نوع" value={m.kind} size="small"
              onChange={(e) => { const kind = e.target.value as ShippingKind; update(i, kind === "PICKUP" ? { kind, price: 0, perKg: 0, provincePrices: [] } : kind === "FLAT" ? { kind, perKg: 0 } : { kind }); }}>
              {SHIPPING_KINDS.map((k) => <MenuItem key={k} value={k}>{SHIPPING_KIND_LABELS[k]}</MenuItem>)}
            </TextField>
            {m.kind !== "PICKUP" && <TextField label={m.kind === "WEIGHT" ? "هزینه تا ۱ کیلو (تومان)" : "هزینه (تومان)"} value={m.price || ""} onChange={(e) => update(i, { price: int(e.target.value) })} size="small" slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }} />}
            {m.kind === "WEIGHT" && <TextField label="هر کیلوی اضافه (تومان)" value={m.perKg || ""} onChange={(e) => update(i, { perKg: int(e.target.value) })} size="small" slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }} />}
            {m.kind === "WEIGHT" && <TextField label="وزن کالای بدون وزن (گرم)" value={m.defaultItemGrams} onChange={(e) => update(i, { defaultItemGrams: int(e.target.value) })} size="small" slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }} />}
            <TextField label="ارسال رایگان از مبلغ (تومان، اختیاری)" value={m.freeAbove ?? ""} onChange={(e) => update(i, { freeAbove: e.target.value.trim() ? int(e.target.value) : null })} size="small" slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }} />
            <TextField label="توضیح برای خریدار (مثلاً ۲ تا ۴ روز کاری)" value={m.description} onChange={(e) => update(i, { description: e.target.value })} size="small" sx={{ gridColumn: { md: "1 / -1" } }} />
          </Box>
          <Provinces label="استان‌های تحت پوشش" help="خالی = همهٔ ایران" value={m.provinces} onChange={(v) => update(i, { provinces: v })} />
          {m.kind !== "PICKUP" && (
            <Box sx={{ display: "grid", gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>قیمت متفاوت برای بعضی استان‌ها (اختیاری)</Typography>
              {m.provincePrices.map((pp, k) => (
                <Box key={k} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <TextField select label="استان" value={pp.province} size="small" sx={{ minWidth: 180 }}
                    onChange={(e) => update(i, { provincePrices: m.provincePrices.map((x, j) => (j === k ? { ...x, province: e.target.value } : x)) })}>
                    {PROVINCES.map((p) => <MenuItem key={p.code} value={p.code}>{p.name}</MenuItem>)}
                  </TextField>
                  <TextField label="هزینه (تومان)" value={pp.price || ""} size="small" slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }}
                    onChange={(e) => update(i, { provincePrices: m.provincePrices.map((x, j) => (j === k ? { ...x, price: int(e.target.value) } : x)) })} />
                  <IconButton aria-label="حذف قیمت این استان" onClick={() => update(i, { provincePrices: m.provincePrices.filter((_, j) => j !== k) })}><DeleteIcon /></IconButton>
                </Box>
              ))}
              <Box><Button size="small" onClick={() => update(i, { provincePrices: [...m.provincePrices, { province: m.provinces[0] ?? "tehran", price: 0 }] })}>افزودن قیمت استانی</Button></Box>
            </Box>
          )}
          <FormControlLabel control={<Switch checked={m.cashOnDelivery.enabled} onChange={(e) => update(i, { cashOnDelivery: { ...m.cashOnDelivery, enabled: e.target.checked } })} />} label="پرداخت در محل" />
          {m.cashOnDelivery.enabled && (
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "2fr 1fr" } }}>
              <Provinces label="استان‌های پرداخت در محل" help="خالی = همهٔ استان‌های این روش" value={m.cashOnDelivery.provinces} onChange={(v) => update(i, { cashOnDelivery: { ...m.cashOnDelivery, provinces: v } })} />
              <TextField label="کارمزد پرداخت در محل (تومان)" value={m.cashOnDelivery.fee || ""} size="small" slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }}
                onChange={(e) => update(i, { cashOnDelivery: { ...m.cashOnDelivery, fee: int(e.target.value) } })} />
            </Box>
          )}
        </Paper>
      ))}
      {error && <Alert severity="error">{error}</Alert>}
      {saved && <Alert severity="success">ذخیره شد و همین حالا در فروشگاه اعمال شد.</Alert>}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Button variant="outlined" onClick={() => setMethods([...methods, blank()])} disabled={methods.length >= MAX_SHIPPING_METHODS}>افزودن روش ارسال</Button>
        <Button variant="contained" onClick={save} disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره"}</Button>
      </Box>
    </Box>
  );
}
