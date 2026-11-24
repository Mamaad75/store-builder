"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DISCOUNT_TYPE_LABELS, type DiscountScope, type DiscountType } from "@store-builder/shared/modules/discounts/discounts";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { createDiscount, deleteDiscount, getCategories, getDiscounts, searchProducts, updateDiscount, type DiscountDto } from "@/client/api";
import { date, failText, toman } from "./labels";

type Form = {
  code: string;
  title: string;
  type: DiscountType;
  value: string;
  maxDiscount: string;
  minOrder: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perCustomerLimit: string;
  firstOrderOnly: boolean;
  scope: DiscountScope;
  scopeIds: string[];
  active: boolean;
};
const EMPTY: Form = { code: "", title: "", type: "PERCENT", value: "", maxDiscount: "", minOrder: "", startsAt: "", endsAt: "", usageLimit: "", perCustomerLimit: "1", firstOrderOnly: false, scope: "ALL", scopeIds: [], active: true };

/** ISO -> the value of a datetime-local input (local time), and back. */
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const num = (v: string) => (v.trim() === "" ? null : v);

function valueLabel(d: Pick<DiscountDto, "type" | "value" | "maxDiscount">) {
  if (d.type === "FREE_SHIPPING") return "ارسال رایگان";
  if (d.type === "FIXED") return toman(d.value);
  return `${d.value.toLocaleString("fa-IR")}٪${d.maxDiscount !== null ? ` تا ${toman(d.maxDiscount)}` : ""}`;
}

/**
 * Phase 5.1: the store's discount codes. One code per order; percentage (with a cap), fixed or free shipping; dates, minimum order,
 * total and per-customer limits, first order only, and chosen products or categories. Changes apply at once (no publishing).
 */
export default function DiscountsManager({ storeId }: { storeId: string }) {
  const [list, setList] = useState<DiscountDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);

  const load = useCallback(() => getDiscounts(storeId).then(setList).catch((e) => setError(failText(e))), [storeId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(d: DiscountDto) {
    try {
      const { id: _id, used: _u, createdAt: _c, ...rest } = d;
      void _id; void _u; void _c;
      await updateDiscount(storeId, d.id, { ...rest, active: !d.active });
      await load();
    } catch (e) {
      setError(failText(e));
    }
  }

  async function remove(d: DiscountDto) {
    if (!window.confirm(`کد ${d.code} حذف شود؟ سفارش‌های قبلی کد و مبلغ تخفیفشان را نگه می‌دارند.`)) return;
    try {
      await deleteDiscount(storeId, d.id);
      await load();
    } catch (e) {
      setError(failText(e));
    }
  }

  const edit = (d: DiscountDto) =>
    setEditing({
      id: d.id,
      form: {
        code: d.code, title: d.title, type: d.type, value: d.type === "FREE_SHIPPING" ? "" : String(d.value), maxDiscount: d.maxDiscount === null ? "" : String(d.maxDiscount),
        minOrder: d.minOrder === null ? "" : String(d.minOrder), startsAt: toLocal(d.startsAt), endsAt: toLocal(d.endsAt), usageLimit: d.usageLimit === null ? "" : String(d.usageLimit),
        perCustomerLimit: d.perCustomerLimit === null ? "" : String(d.perCustomerLimit), firstOrderOnly: d.firstOrderOnly, scope: d.scope, scopeIds: d.scopeIds, active: d.active,
      },
    });

  if (!list) return error ? <Alert severity="error">{error}</Alert> : <Typography color="text.secondary">در حال بارگذاری…</Typography>;
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Box><Button variant="contained" onClick={() => setEditing({ id: null, form: EMPTY })}>کد تخفیف تازه</Button></Box>
      {list.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3 }}><Typography color="text.secondary">هنوز کد تخفیفی نساخته‌اید.</Typography></Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small" aria-label="کدهای تخفیف">
            <TableHead>
              <TableRow>
                <TableCell>کد</TableCell>
                <TableCell>تخفیف</TableCell>
                <TableCell>شرایط</TableCell>
                <TableCell>استفاده</TableCell>
                <TableCell>فعال</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Typography dir="ltr" sx={{ fontFamily: "monospace", fontWeight: 700 }}>{d.code}</Typography>
                    {d.title && <Typography variant="body2" color="text.secondary">{d.title}</Typography>}
                  </TableCell>
                  <TableCell>{valueLabel(d)}</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {[
                        d.minOrder !== null ? `حداقل خرید ${toman(d.minOrder)}` : null,
                        d.scope === "PRODUCTS" ? `${d.scopeIds.length.toLocaleString("fa-IR")} محصول` : d.scope === "CATEGORIES" ? `${d.scopeIds.length.toLocaleString("fa-IR")} دسته` : null,
                        d.firstOrderOnly ? "فقط خرید اول" : null,
                        d.perCustomerLimit !== null ? `هر مشتری ${d.perCustomerLimit.toLocaleString("fa-IR")} بار` : null,
                        d.endsAt ? `تا ${date(d.endsAt)}` : null,
                        d.startsAt && new Date(d.startsAt) > new Date() ? `از ${date(d.startsAt)}` : null,
                      ].filter(Boolean).join("، ") || "بدون شرط"}
                    </Typography>
                  </TableCell>
                  <TableCell>{d.used.toLocaleString("fa-IR")}{d.usageLimit !== null ? ` از ${d.usageLimit.toLocaleString("fa-IR")}` : ""}</TableCell>
                  <TableCell><Switch checked={d.active} onChange={() => toggle(d)} slotProps={{ input: { "aria-label": `فعال بودن ${d.code}` } }} /></TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Button size="small" onClick={() => edit(d)}>ویرایش</Button>
                    <Button size="small" color="error" onClick={() => remove(d)}>حذف</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {editing && <DiscountDialog storeId={storeId} id={editing.id} initial={editing.form} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
    </Box>
  );
}

function DiscountDialog({ storeId, id, initial, onClose, onSaved }: { storeId: string; id: string | null; initial: Form; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState<Form>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  // The picker's options: all categories, or products matching the search (names of chosen ones are remembered).
  useEffect(() => {
    if (f.scope === "ALL") return;
    const load = f.scope === "CATEGORIES" ? getCategories(storeId) : searchProducts(storeId, search).then((r) => r.items);
    let live = true;
    load
      .then((items) => {
        if (!live) return;
        const list = items.map((i) => ({ id: i.id, name: i.name }));
        setOptions(list);
        setNames((n) => ({ ...n, ...Object.fromEntries(list.map((i) => [i.id, i.name])) }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [storeId, f.scope, search]);

  async function save() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const body = {
      code: f.code, title: f.title, type: f.type, value: f.type === "FREE_SHIPPING" ? 0 : f.value, maxDiscount: f.type === "PERCENT" ? num(f.maxDiscount) : null,
      minOrder: num(f.minOrder), startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt), usageLimit: num(f.usageLimit), perCustomerLimit: num(f.perCustomerLimit),
      firstOrderOnly: f.firstOrderOnly, scope: f.scope, scopeIds: f.scope === "ALL" ? [] : f.scopeIds, active: f.active,
    };
    try {
      if (id) await updateDiscount(storeId, id, body);
      else await createDiscount(storeId, body);
      await onSaved();
    } catch (e) {
      if (e instanceof ValidationError) {
        setFieldErrors(e.fieldErrors);
        setError("لطفاً موارد مشخص‌شده را اصلاح کنید.");
      } else setError(failText(e));
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => fieldErrors[k]?.[0];
  const selected = f.scopeIds.map((x) => ({ id: x, name: names[x] ?? "…" }));
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="discount-dialog-title">
      <DialogTitle id="discount-dialog-title">{id ? "ویرایش کد تخفیف" : "کد تخفیف تازه"}</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2, pt: "8px !important" }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
          <TextField label="کد (مثلاً YALDA1405)" value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} error={!!err("code")} helperText={err("code") ?? "حروف انگلیسی، عدد، - و _"} slotProps={{ htmlInput: { dir: "ltr", maxLength: 32 } }} size="small" />
          <TextField label="عنوان (اختیاری، فقط برای شما)" value={f.title} onChange={(e) => set("title", e.target.value)} error={!!err("title")} helperText={err("title") ?? " "} size="small" />
          <TextField select label="نوع تخفیف" value={f.type} onChange={(e) => set("type", e.target.value as DiscountType)} size="small">
            {(Object.keys(DISCOUNT_TYPE_LABELS) as DiscountType[]).map((t) => <MenuItem key={t} value={t}>{DISCOUNT_TYPE_LABELS[t]}</MenuItem>)}
          </TextField>
          {f.type !== "FREE_SHIPPING" && (
            <TextField label={f.type === "PERCENT" ? "درصد تخفیف" : "مبلغ تخفیف (تومان)"} value={f.value} onChange={(e) => set("value", e.target.value)} error={!!err("value")} helperText={err("value") ?? " "} slotProps={{ htmlInput: { dir: "ltr", inputMode: "numeric" } }} size="small" />
          )}
          {f.type === "PERCENT" && (
            <TextField label="سقف تخفیف (تومان، اختیاری)" value={f.maxDiscount} onChange={(e) => set("maxDiscount", e.target.value)} error={!!err("maxDiscount")} helperText={err("maxDiscount") ?? " "} slotProps={{ htmlInput: { dir: "ltr", inputMode: "numeric" } }} size="small" />
          )}
          <TextField label="حداقل مبلغ خرید (تومان، اختیاری)" value={f.minOrder} onChange={(e) => set("minOrder", e.target.value)} error={!!err("minOrder")} helperText={err("minOrder") ?? " "} slotProps={{ htmlInput: { dir: "ltr", inputMode: "numeric" } }} size="small" />
          <TextField label="شروع (اختیاری)" type="datetime-local" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} error={!!err("startsAt")} helperText={err("startsAt") ?? " "} slotProps={{ inputLabel: { shrink: true } }} size="small" />
          <TextField label="پایان (اختیاری)" type="datetime-local" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} error={!!err("endsAt")} helperText={err("endsAt") ?? " "} slotProps={{ inputLabel: { shrink: true } }} size="small" />
          <TextField label="سقف کل استفاده (اختیاری)" value={f.usageLimit} onChange={(e) => set("usageLimit", e.target.value)} error={!!err("usageLimit")} helperText={err("usageLimit") ?? " "} slotProps={{ htmlInput: { dir: "ltr", inputMode: "numeric" } }} size="small" />
          <TextField label="سقف استفاده‌ی هر مشتری (اختیاری)" value={f.perCustomerLimit} onChange={(e) => set("perCustomerLimit", e.target.value)} error={!!err("perCustomerLimit")} helperText={err("perCustomerLimit") ?? "بر اساس شماره‌ی موبایل"} slotProps={{ htmlInput: { dir: "ltr", inputMode: "numeric" } }} size="small" />
        </Box>
        <TextField select label="برای کدام کالاها" value={f.scope} onChange={(e) => setF((x) => ({ ...x, scope: e.target.value as DiscountScope, scopeIds: [] }))} size="small">
          <MenuItem value="ALL">همه‌ی کالاها</MenuItem>
          <MenuItem value="PRODUCTS">فقط محصولات انتخاب‌شده</MenuItem>
          <MenuItem value="CATEGORIES">فقط دسته‌های انتخاب‌شده</MenuItem>
        </TextField>
        {f.scope !== "ALL" && (
          <Autocomplete
            multiple
            options={options}
            value={selected}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            filterOptions={(x) => x}
            onInputChange={(_e, v, reason) => reason === "input" && setSearch(v)}
            onChange={(_e, v) => {
              setNames((n) => ({ ...n, ...Object.fromEntries(v.map((i) => [i.id, i.name])) }));
              set("scopeIds", v.map((i) => i.id));
            }}
            renderValue={(v, getItemProps) => v.map((o, index) => <Chip size="small" label={o.name} {...getItemProps({ index })} key={o.id} />)}
            renderInput={(p) => <TextField {...p} label={f.scope === "PRODUCTS" ? "جستجو و انتخاب محصول" : "انتخاب دسته"} error={!!err("scopeIds")} helperText={err("scopeIds") ?? " "} size="small" />}
            noOptionsText="موردی پیدا نشد"
          />
        )}
        <FormControlLabel control={<Switch checked={f.firstOrderOnly} onChange={(e) => set("firstOrderOnly", e.target.checked)} />} label="فقط برای اولین خرید (شماره‌ای که پیش‌تر از این فروشگاه نخریده)" />
        <FormControlLabel control={<Switch checked={f.active} onChange={(e) => set("active", e.target.checked)} />} label="فعال" />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>انصراف</Button>
        <Button variant="contained" onClick={save} disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره"}</Button>
      </DialogActions>
    </Dialog>
  );
}
