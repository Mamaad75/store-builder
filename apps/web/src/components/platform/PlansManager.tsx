"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { createPlan, listPlans, updatePlan, type PlanDto } from "@/client/platform-api";
import { toman } from "@/components/orders/labels";
import { MAX_PRODUCTS_PER_STORE } from "@store-builder/shared/modules/products/schemas";
import { MAX_STAFF_PER_STORE } from "@store-builder/shared/modules/access/permissions";

const fa = (n: number) => n.toLocaleString("fa-IR");
type Form = { name: string; description: string; price: string; days: string; maxProducts: string; maxStaff: string; active: boolean };
const EMPTY: Form = { name: "", description: "", price: "", days: "30", maxProducts: "100", maxStaff: "3", active: true };
const num = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
const firstError = (e: unknown) => (e instanceof Error && e.name === "ValidationError" ? (Object.values((e as Error & { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {}).flat()[0] ?? "مقدارها را بررسی کنید.") : "ذخیره ممکن نشد؛ دوباره تلاش کنید.");

/** The subscription plans: created and changed here by platform staff. A plan is never deleted: switching it off only stops new purchases. */
export default function PlansManager() {
  const [plans, setPlans] = useState<PlanDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => listPlans().then(setPlans).catch(() => setError("بارگذاری ممکن نشد.")), []);
  useEffect(() => {
    load();
  }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const f = editing.form;
    const body = { name: f.name, description: f.description, priceToman: num(f.price), durationDays: num(f.days), maxProducts: num(f.maxProducts), maxStaff: num(f.maxStaff), active: f.active };
    setBusy(true);
    setError(null);
    try {
      await (editing.id ? updatePlan(editing.id, body) : createPlan(body));
      setEditing(null);
      await load();
    } catch (err) {
      setError(firstError(err));
    } finally {
      setBusy(false);
    }
  }
  const set = (patch: Partial<Form>) => setEditing((x) => (x ? { ...x, form: { ...x.form, ...patch } } : x));

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="body2" color="text.secondary">پلن‌های فعال را فروشنده‌ها در «مالی ← اشتراک‌ها» می‌بینند. قیمت به تومان و صحیح است.</Typography>
        {!editing && <Button variant="contained" onClick={() => setEditing({ id: null, form: EMPTY })}>پلن تازه</Button>}
      </Stack>
      {error && <Alert severity="error" role="alert">{error}</Alert>}
      {editing && (
        <Paper variant="outlined" component="form" onSubmit={save} noValidate sx={{ p: 2 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1.5 }}>{editing.id ? "ویرایش پلن" : "پلن تازه"}</Typography>
          <Stack spacing={2}>
            <TextField label="نام پلن" value={editing.form.name} onChange={(e) => set({ name: e.target.value })} required slotProps={{ htmlInput: { maxLength: 60 } }} />
            <TextField label="توضیح (اختیاری)" value={editing.form.description} onChange={(e) => set({ description: e.target.value })} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300 } }} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="قیمت (تومان)" value={editing.form.price} onChange={(e) => set({ price: e.target.value })} required slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }} helperText="۰ = رایگان" />
              <TextField label="مدت (روز)" value={editing.form.days} onChange={(e) => set({ days: e.target.value })} required slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }} />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="سقف محصولات" value={editing.form.maxProducts} onChange={(e) => set({ maxProducts: e.target.value })} required slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }} helperText={`حداکثر ${fa(MAX_PRODUCTS_PER_STORE)}`} />
              <TextField label="سقف همکاران" value={editing.form.maxStaff} onChange={(e) => set({ maxStaff: e.target.value })} required slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }} helperText={`عضو تیم و دعوت‌های در انتظار؛ ۰ = فقط مالک (حداکثر ${fa(MAX_STAFF_PER_STORE)})`} />
            </Stack>
            <FormControlLabel control={<Switch checked={editing.form.active} onChange={(e) => set({ active: e.target.checked })} />} label="برای فروش فعال باشد" />
            <Stack direction="row" spacing={1}>
              <Button type="submit" variant="contained" disabled={busy}>ذخیره</Button>
              <Button onClick={() => { setEditing(null); setError(null); }} disabled={busy}>انصراف</Button>
            </Stack>
          </Stack>
        </Paper>
      )}
      {!plans && !error && <Skeleton variant="rounded" height={72} />}
      {plans && plans.length === 0 && <Typography color="text.secondary">هنوز پلنی نساخته‌اید.</Typography>}
      {plans && plans.length > 0 && (
        <Box component="ul" aria-label="پلن‌ها" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
          {plans.map((p) => (
            <Paper key={p.id} component="li" variant="outlined" data-testid="plan-row" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{p.name}</Typography>
                <Typography variant="body2" color="text.secondary">{p.priceToman === 0 ? "رایگان" : toman(p.priceToman)} · {fa(p.durationDays)} روز · تا {fa(p.maxProducts)} محصول · {fa(p.maxStaff)} همکار</Typography>
              </Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Chip size="small" color={p.active ? "success" : "default"} variant={p.active ? "filled" : "outlined"} label={p.active ? "فعال" : "غیرفعال"} />
                <Button size="small" onClick={() => setEditing({ id: p.id, form: { name: p.name, description: p.description, price: String(p.priceToman), days: String(p.durationDays), maxProducts: String(p.maxProducts), maxStaff: String(p.maxStaff), active: p.active } })} aria-label={`ویرایش پلن ${p.name}`}>ویرایش</Button>
              </Stack>
            </Paper>
          ))}
        </Box>
      )}
    </Stack>
  );
}
