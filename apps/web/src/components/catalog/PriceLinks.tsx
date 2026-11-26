"use client";

import { useMemo, useState } from "react";
import LinkOutlined from "@mui/icons-material/LinkOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { removePriceLink, setPriceLink, type CurrentRates, type PriceLinkView } from "@/client/api";
import { refresh } from "@/client/nav";
import { failText } from "@/components/orders/labels";
import { ROUNDING_STEPS } from "@store-builder/shared/modules/pricing/pricing";
import { buildLinkInput, EMPTY_LINK_FORM, formFromLink, previewPrice, type LinkForm } from "./price-link-form";

const fa = (n: number) => n.toLocaleString("fa-IR");
const toman = (n: number) => `${fa(n)} تومان`;
const KIND_LABEL = { USD: "دلار", GOLD: "طلا (۱۸ عیار)" } as const;
const ltr = { htmlInput: { dir: "ltr" as const, inputMode: "decimal" as const } };

/** "متصل به دلار" / "متصل به طلا", with a warning when the last rate fell outside the price limits. */
export function LinkChip({ link }: { link: PriceLinkView }) {
  return (
    <Chip
      size="small"
      icon={<LinkOutlined />}
      color={link.status === "OK" ? "info" : "warning"}
      variant="outlined"
      label={link.status === "OK" ? `متصل به ${link.kind === "USD" ? "دلار" : "طلا"}` : `متصل به ${link.kind === "USD" ? "دلار" : "طلا"} — نرخ خارج از محدوده، قیمت قبلی مانده`}
    />
  );
}

function LinkBody({ storeId, productId, variantId, current, rates, onClose }: { storeId: string; productId: string; variantId: string | null; current?: PriceLinkView; rates: CurrentRates | null; onClose: () => void }) {
  const [form, setForm] = useState<LinkForm>(current ? formFromLink(current) : EMPTY_LINK_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof LinkForm>(k: K, v: LinkForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const built = useMemo(() => buildLinkInput(form), [form]);
  const preview = built.ok && rates ? previewPrice(built.input, rates) : null;
  const rate = rates?.[form.kind === "USD" ? "USD" : "GOLD18"] ?? null;

  async function save() {
    if (!built.ok) return setError(built.error);
    setBusy(true);
    setError(null);
    try {
      await setPriceLink(storeId, productId, variantId, built.input);
      onClose();
      refresh();
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogContent sx={{ display: "grid", gap: 2, pt: 1 }}>
        <Alert severity="info">
          قیمت این {variantId ? "تنوع" : "محصول"} با هر به‌روزرسانی نرخ، خودکار محاسبه می‌شود و قیمت فروشگاه منتشرشده همان لحظه تغییر می‌کند. تا وقتی اتصال هست، قیمت را نمی‌شود دستی تغییر داد.
        </Alert>
        <ToggleButtonGroup exclusive size="small" value={form.kind} onChange={(_, v) => v && set("kind", v)} aria-label="نرخ مرجع" disabled={!!current}>
          <ToggleButton value="USD">{KIND_LABEL.USD}</ToggleButton>
          <ToggleButton value="GOLD">{KIND_LABEL.GOLD}</ToggleButton>
        </ToggleButtonGroup>
        {current && <Typography variant="caption" color="text.secondary">برای عوض‌کردن نوع نرخ، اتصال را بردارید و دوباره بسازید.</Typography>}
        <Typography variant="body2" color={rate ? "text.secondary" : "error"}>
          {rate ? `نرخ امروز ${KIND_LABEL[form.kind]}: ${toman(rate.rateToman)}${form.kind === "GOLD" ? " (هر گرم)" : ""}` : "هنوز نرخی برای این مورد ثبت نشده است؛ پشتیبانی پلتفرم باید نرخ را وارد کند. تا آن موقع پیش‌نمایش قیمت در دسترس نیست."}
        </Typography>

        <ToggleButtonGroup exclusive size="small" value={form.basis} onChange={(_, v) => v && set("basis", v)} aria-label="روش تعیین قیمت">
          <ToggleButton value="toman">از قیمت امروز (تومان)</ToggleButton>
          <ToggleButton value="native">{form.kind === "USD" ? "از مبلغ دلاری" : "از وزن و اجرت"}</ToggleButton>
        </ToggleButtonGroup>

        {form.basis === "toman" ? (
          <TextField label="قیمت امروز این کالا (تومان)" value={form.toman} onChange={(e) => set("toman", e.target.value)} size="small" helperText={form.kind === "USD" ? "با نرخ امروز به معادل دلاری تبدیل می‌شود." : "با نرخ امروز به وزن معادل طلا تبدیل می‌شود (بدون اجرت)."} slotProps={ltr} />
        ) : form.kind === "USD" ? (
          <TextField label="مبلغ به دلار" value={form.usd} onChange={(e) => set("usd", e.target.value)} size="small" helperText="مثلاً ۱۲۰ یا ۹۹٫۵۰" slotProps={ltr} />
        ) : (
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)" } }}>
            <TextField label="وزن (گرم)" value={form.grams} onChange={(e) => set("grams", e.target.value)} size="small" slotProps={ltr} />
            <TextField label="اجرت ساخت (٪)" value={form.wage} onChange={(e) => set("wage", e.target.value)} size="small" slotProps={ltr} />
            <TextField label="سود فروشنده (٪)" value={form.profit} onChange={(e) => set("profit", e.target.value)} size="small" slotProps={ltr} />
            <TextField label="مالیات (٪)" value={form.tax} onChange={(e) => set("tax", e.target.value)} size="small" slotProps={ltr} />
            <TextField label="هزینهٔ سنگ (تومان)" value={form.stone} onChange={(e) => set("stone", e.target.value)} size="small" slotProps={ltr} sx={{ gridColumn: { xs: "1 / -1", sm: "auto" } }} />
          </Box>
        )}

        <TextField select label="گرد کردن قیمت" value={form.rounding} onChange={(e) => set("rounding", Number(e.target.value))} size="small" sx={{ maxWidth: 260 }}>
          {ROUNDING_STEPS.map((n) => (
            <MenuItem key={n} value={n}>{n === 1 ? "بدون گرد کردن" : `به نزدیک‌ترین ${fa(n)} تومان`}</MenuItem>
          ))}
        </TextField>

        <Box data-testid="link-preview" sx={{ p: 1.5, borderRadius: 2, bgcolor: "#f3f4fb" }} aria-live="polite">
          {!built.ok ? (
            <Typography variant="body2" color="text.secondary">{built.error}</Typography>
          ) : !preview ? (
            <Typography variant="body2" color="text.secondary">پیش‌نمایش قیمت پس از ثبت نرخ در دسترس است.</Typography>
          ) : preview.ok ? (
            <Typography>قیمت با نرخ امروز: <strong>{toman(preview.price)}</strong></Typography>
          ) : (
            <Typography color="error" variant="body2">{preview.reason === "no_rate" ? "نرخ امروز ثبت نشده است." : "قیمت محاسبه‌شده خارج از حد مجاز است؛ مقادیر را بررسی کنید."}</Typography>
          )}
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>انصراف</Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || !built.ok || !preview || !preview.ok}>
          {current ? "ذخیرهٔ اتصال" : "اتصال قیمت"}
        </Button>
      </DialogActions>
    </>
  );
}

/** The dialog that links (or edits the link of) a product's or a variant's price to the dollar or gold. */
export function PriceLinkDialog(p: { open: boolean; onClose: () => void; storeId: string; productId: string; variantId: string | null; current?: PriceLinkView; rates: CurrentRates | null }) {
  return (
    <Dialog open={p.open} onClose={p.onClose} fullWidth maxWidth="sm" aria-labelledby="link-title">
      <DialogTitle id="link-title">اتصال قیمت به دلار یا طلا</DialogTitle>
      {p.open && <LinkBody storeId={p.storeId} productId={p.productId} variantId={p.variantId} current={p.current} rates={p.rates} onClose={p.onClose} />}
    </Dialog>
  );
}

/** Removes a link; the price stays at its last value. */
export async function removeLink(storeId: string, productId: string, variantId: string | null): Promise<string | null> {
  try {
    await removePriceLink(storeId, productId, variantId);
    refresh();
    return null;
  } catch (e) {
    return failText(e);
  }
}

/**
 * The product-level link card (a product WITHOUT variants): link the price to the dollar or gold, see the current state, change or remove.
 * Needs the `publish` permission (the price of a live store changes at once): others see the state but no buttons.
 */
export function ProductPriceLinkCard({ storeId, productId, link, rates, canLink }: { storeId: string; productId: string; link: PriceLinkView | null; rates: CurrentRates | null; canLink: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Paper variant="outlined" component="section" aria-labelledby="plink-h" data-testid="product-price-link" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
      <Typography id="plink-h" component="h2" variant="h6" sx={{ fontWeight: 700 }}>اتصال قیمت به دلار یا طلا</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>برای کالاهای وابسته به نرخ ارز یا طلا: قیمت با هر تغییر نرخ خودکار به‌روز می‌شود.</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {link ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <LinkChip link={link} />
          {link.lastPriceToman !== null && <Typography>آخرین قیمت: <strong>{toman(link.lastPriceToman)}</strong></Typography>}
          {canLink && (
            <>
              <Button size="small" onClick={() => setOpen(true)}>تغییر اتصال</Button>
              <Button size="small" color="error" onClick={() => void removeLink(storeId, productId, null).then(setError)}>برداشتن اتصال</Button>
            </>
          )}
        </Box>
      ) : canLink ? (
        <Button variant="outlined" startIcon={<LinkOutlined />} onClick={() => setOpen(true)}>اتصال قیمت</Button>
      ) : (
        <Typography variant="body2" color="text.secondary">اتصال قیمت را فقط مالک یا مدیر فروشگاه می‌تواند انجام دهد.</Typography>
      )}
      <PriceLinkDialog open={open} onClose={() => setOpen(false)} storeId={storeId} productId={productId} variantId={null} current={link ?? undefined} rates={rates} />
    </Paper>
  );
}
