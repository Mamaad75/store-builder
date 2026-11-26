"use client";

import { useState } from "react";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import LinkOutlined from "@mui/icons-material/LinkOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { replaceVariants, type CurrentRates, type PriceLinkView, type VariantView } from "@/client/api";
import { refresh } from "@/client/nav";
import { failText } from "@/components/orders/labels";
import { MAX_OPTIONS, MAX_VARIANTS_PER_PRODUCT } from "@store-builder/shared/modules/inventory/variants";
import { LinkChip, PriceLinkDialog, removeLink } from "./PriceLinks";
import { combinations, initialFrom, labelOf, toDrafts, type VariantRow } from "./variants-form";

const fa = (n: number) => n.toLocaleString("fa-IR");
const num = { htmlInput: { inputMode: "numeric" as const, dir: "ltr" as const } };

/**
 * A product's variants (colour, size…): the option names and their values make every combination, each with its own price, stock and
 * optional SKU. The product then shows the lowest price and the total stock. A variant's price can follow the dollar or gold (owner or
 * manager). Saving replaces the whole set; the server checks every rule again.
 */
export default function VariantsEditor({ storeId, productId, variants, links, rates, canLink, defaultPrice, productLinked }: {
  storeId: string;
  productId: string;
  variants: VariantView[];
  links: PriceLinkView[];
  rates: CurrentRates | null;
  canLink: boolean;
  defaultPrice: number;
  productLinked: boolean;
}) {
  const start = initialFrom(variants);
  const [names, setNames] = useState<string[]>(start.names);
  const [valuesText, setValuesText] = useState<string[]>(start.valuesText);
  const [rows, setRows] = useState<VariantRow[]>(start.rows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linking, setLinking] = useState<{ variantId: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const linkOf = (variantId: string) => links.find((l) => l.variantId === variantId);
  const stored = new Map(variants.map((v) => [JSON.stringify(v.options.map((o) => [o.name, o.value])), v]));
  const idOf = (r: VariantRow) => stored.get(JSON.stringify(r.options.map((o) => [o.name, o.value])))?.id ?? null;

  function generate() {
    setError(null);
    setNotice(null);
    const r = combinations(names, valuesText, rows, String(defaultPrice));
    if (!r.ok) return setError(r.error);
    setRows(r.rows);
  }

  async function save(next: VariantRow[]) {
    const d = toDrafts(next);
    if (!d.ok) return setError(d.error);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await replaceVariants(storeId, productId, d.variants);
      setNotice(d.variants.length === 0 ? "تنوع‌ها برداشته شد؛ محصول دوباره قیمت و موجودی خودش را دارد." : "تنوع‌ها ذخیره شد.");
      refresh();
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }
  const setRow = (i: number, patch: Partial<VariantRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const hasStored = variants.length > 0;

  return (
    <Paper variant="outlined" component="section" aria-labelledby="variants-h" data-testid="variants-editor" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
      <Typography id="variants-h" component="h2" variant="h6" sx={{ fontWeight: 700 }}>تنوع‌ها (رنگ، سایز و …)</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        اگر این محصول چند حالت دارد، ویژگی‌ها و مقدارهایشان را بنویسید تا همهٔ ترکیب‌ها ساخته شود؛ بعد قیمت و موجودی هر ترکیب را وارد کنید. قیمت محصول کمترین قیمت تنوع‌ها و موجودی آن جمع موجودی‌هاست.
      </Typography>
      {productLinked && <Alert severity="warning" sx={{ mb: 2 }}>قیمت خود محصول به دلار یا طلا متصل است. برای تعریف تنوع، اول اتصال بالا را بردارید.</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} role="alert">{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} role="status">{notice}</Alert>}

      <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, display: "grid", gap: 1.5, minWidth: 0 }} disabled={productLinked}>
        <Typography component="legend" sx={{ fontWeight: 600, mb: 1 }}>ویژگی‌ها</Typography>
        {names.map((n, i) => (
          <Box key={i} sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 2fr auto" }, alignItems: "start" }}>
            <TextField label={`نام ویژگی ${fa(i + 1)}`} value={n} onChange={(e) => setNames((a) => a.map((x, j) => (j === i ? e.target.value : x)))} size="small" slotProps={{ htmlInput: { maxLength: 30 } }} />
            <TextField label="مقدارها (با ویرگول جدا کنید)" value={valuesText[i] ?? ""} onChange={(e) => setValuesText((a) => a.map((x, j) => (j === i ? e.target.value : x)))} size="small" placeholder={i === 0 ? "قرمز، آبی، سبز" : "S، M، L"} />
            {names.length > 1 ? (
              <IconButton aria-label={`حذف ویژگی ${n || fa(i + 1)}`} onClick={() => { setNames((a) => a.filter((_, j) => j !== i)); setValuesText((a) => a.filter((_, j) => j !== i)); }}><DeleteOutlined /></IconButton>
            ) : <span />}
          </Box>
        ))}
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          {names.length < MAX_OPTIONS && (
            <Button size="small" onClick={() => { setNames((a) => [...a, ""]); setValuesText((a) => [...a, ""]); }}>افزودن ویژگی</Button>
          )}
          <Button size="small" variant="outlined" onClick={generate}>ساخت ترکیب‌ها</Button>
        </Box>
      </Box>

      {rows.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography sx={{ fontWeight: 600, mb: 1 }}>{fa(rows.length)} ترکیب (حداکثر {fa(MAX_VARIANTS_PER_PRODUCT)})</Typography>
          <Box sx={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="جدول تنوع‌ها">
            <Table size="small" aria-label="تنوع‌های محصول" sx={{ "& th, & td": { px: { xs: 0.75, sm: 1.5 } } }}>
              <TableHead>
                <TableRow>
                  <TableCell>ترکیب</TableCell>
                  <TableCell>قیمت (تومان)</TableCell>
                  <TableCell>موجودی</TableCell>
                  <TableCell>کد انبار (اختیاری)</TableCell>
                  <TableCell><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>عملیات</span></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => {
                  const id = idOf(r);
                  const link = id ? linkOf(id) : undefined;
                  const name = labelOf(r);
                  return (
                    <TableRow key={name + i} data-testid="variant-row">
                      <TableCell sx={{ whiteSpace: "nowrap", fontWeight: 600 }}>{name}</TableCell>
                      <TableCell sx={{ minWidth: 150 }}>
                        <TextField size="small" value={link?.lastPriceToman != null ? String(link.lastPriceToman) : r.price} onChange={(e) => setRow(i, { price: e.target.value })} disabled={!!link} slotProps={{ ...num, htmlInput: { ...num.htmlInput, "aria-label": `قیمت ${name}` } }} />
                        {link && <Box sx={{ mt: 0.5 }}><LinkChip link={link} /></Box>}
                      </TableCell>
                      <TableCell sx={{ minWidth: 100 }}>
                        <TextField size="small" value={r.stock} onChange={(e) => setRow(i, { stock: e.target.value })} slotProps={{ ...num, htmlInput: { ...num.htmlInput, "aria-label": `موجودی ${name}` } }} />
                      </TableCell>
                      <TableCell sx={{ minWidth: 130 }}>
                        <TextField size="small" value={r.sku} onChange={(e) => setRow(i, { sku: e.target.value })} slotProps={{ htmlInput: { dir: "ltr", maxLength: 64, "aria-label": `کد انبار ${name}` } }} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {id && canLink && (
                          link ? (
                            <>
                              <Button size="small" onClick={() => setLinking({ variantId: id })}>تغییر اتصال</Button>
                              <Button size="small" color="error" onClick={() => void removeLink(storeId, productId, id).then((e) => e && setError(e))}>برداشتن اتصال</Button>
                            </>
                          ) : (
                            <Button size="small" startIcon={<LinkOutlined />} onClick={() => setLinking({ variantId: id })} aria-label={`اتصال قیمت ${name} به دلار یا طلا`}>اتصال قیمت</Button>
                          )
                        )}
                        <IconButton aria-label={`حذف ترکیب ${name}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={!!link}><DeleteOutlined /></IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
          {canLink && rows.some((r) => !idOf(r)) && <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>برای اتصال قیمت یک ترکیب به دلار یا طلا، اول تنوع‌ها را ذخیره کنید.</Typography>}
        </Box>
      )}

      <Box sx={{ display: "flex", gap: 1.5, mt: 3, flexWrap: "wrap" }}>
        <Button variant="contained" onClick={() => void save(rows)} disabled={busy || productLinked || rows.length === 0}>ذخیرهٔ تنوع‌ها</Button>
        {hasStored && <Button color="error" onClick={() => setConfirmClear(true)} disabled={busy}>برداشتن همهٔ تنوع‌ها</Button>}
      </Box>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} aria-labelledby="clear-title" aria-describedby="clear-desc">
        <DialogTitle id="clear-title">برداشتن همهٔ تنوع‌ها؟</DialogTitle>
        <DialogContent>
          <DialogContentText id="clear-desc">قیمت و موجودی هر ترکیب حذف می‌شود و محصول فقط یک قیمت و یک موجودی خواهد داشت. سبدهای خرید باز که این ترکیب‌ها را دارند دیگر معتبر نیستند.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClear(false)}>انصراف</Button>
          <Button color="error" variant="contained" onClick={() => { setConfirmClear(false); setRows([]); void save([]); }}>برداشتن</Button>
        </DialogActions>
      </Dialog>

      {linking && (
        <PriceLinkDialog open onClose={() => setLinking(null)} storeId={storeId} productId={productId} variantId={linking.variantId} current={linkOf(linking.variantId)} rates={rates} />
      )}
    </Paper>
  );
}
