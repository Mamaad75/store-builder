"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { MAX_SPEC_ROWS, SPEC_LABEL_MAX, SPEC_VALUE_MAX, type SpecRow } from "@/lib/product-specs";

export type SpecsInitial =
  | { state: "valid"; rows: SpecRow[] }
  /** Stored specs that fail validation: kept exactly as stored until the owner explicitly replaces or clears them. */
  | { state: "invalid"; problem: string; preview: string };

export interface PresetOption {
  key: string;
  name: string;
  labels: string[];
}

interface Row extends SpecRow {
  id: number;
}

let nextId = 1;
const withId = (r: SpecRow): Row => ({ ...r, id: nextId++ });

/**
 * Specification rows of a product. Posts `specLabel`/`specValue` pairs plus `specsIntent`:
 *  - "replace": the rows below are written (the normal case)
 *  - "keep":    (invalid stored specs only) nothing about specs is sent; they stay exactly as stored
 *  - "clear":   (invalid stored specs only) the owner explicitly removes them
 * Presets only add label rows to fill in; they are optional and any label can be typed freely.
 */
export default function ProductSpecsEditor({ initial, presets, error }: { initial: SpecsInitial; presets: PresetOption[]; error?: string }) {
  const [choice, setChoice] = useState<"keep" | "replace" | "clear">(initial.state === "valid" ? "replace" : "keep");
  const [rows, setRows] = useState<Row[]>(initial.state === "valid" ? initial.rows.map(withId) : []);
  const editing = choice === "replace";

  const update = (id: number, patch: Partial<SpecRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addPreset = (key: string) => {
    const p = presets.find((x) => x.key === key);
    if (!p) return;
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.label.trim().toLowerCase()));
      const add = p.labels.filter((l) => !have.has(l.toLowerCase())).map((label) => withId({ label, value: "" }));
      return [...rs, ...add].slice(0, MAX_SPEC_ROWS);
    });
  };

  return (
    <Stack spacing={1.5} data-testid="specs-editor" data-specs-state={initial.state}>
      <input type="hidden" name="specsIntent" value={choice} />
      <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 700 }}>
        مشخصات فنی (اختیاری)
      </Typography>

      {initial.state === "invalid" && (
        <Alert severity="warning" data-testid="specs-invalid">
          <Stack spacing={1}>
            <span>
              <strong>مشخصات ذخیره‌شدهٔ این محصول معتبر نیست</strong> ({initial.problem}). این اطلاعات دست‌نخورده نگه‌داری می‌شود، در فروشگاه نمایش داده نمی‌شود و ذخیرهٔ سایر فیلدها آن را تغییر نمی‌دهد. برای رفع مشکل یکی از دو گزینهٔ زیر را به‌صورت آگاهانه انتخاب کنید.
            </span>
            <Box component="pre" dir="ltr" sx={{ m: 0, p: 1, bgcolor: "action.hover", overflow: "auto", maxHeight: 140, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }} data-testid="specs-invalid-preview">
              {initial.preview}
            </Box>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              <Button type="button" size="small" variant={choice === "replace" ? "contained" : "outlined"} onClick={() => setChoice("replace")} data-testid="specs-replace">
                جایگزینی با مشخصات جدید
              </Button>
              <Button type="button" size="small" color="error" variant={choice === "clear" ? "contained" : "outlined"} onClick={() => setChoice("clear")} data-testid="specs-clear">
                پاک‌سازی مشخصات نامعتبر
              </Button>
              {choice !== "keep" && (
                <Button type="button" size="small" onClick={() => setChoice("keep")} data-testid="specs-keep">
                  انصراف (نگه‌داشتن همان‌طور که هست)
                </Button>
              )}
            </Stack>
            {choice === "clear" && <span data-testid="specs-clear-note">با «ذخیره تغییرات»، مشخصات نامعتبر حذف می‌شود.</span>}
          </Stack>
        </Alert>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {editing && (
        <>
          {rows.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              هنوز ویژگی‌ای اضافه نشده است. مثال: «برند: سامسونگ».
            </Typography>
          )}
          {rows.map((r, i) => (
            <Stack key={r.id} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-start" } }} data-testid="spec-row">
              <TextField name="specLabel" label={`نام ویژگی ${(i + 1).toLocaleString("fa-IR")}`} value={r.label} onChange={(e) => update(r.id, { label: e.target.value })} size="small" fullWidth slotProps={{ htmlInput: { maxLength: SPEC_LABEL_MAX * 2 } }} />
              <TextField name="specValue" label="مقدار" value={r.value} onChange={(e) => update(r.id, { value: e.target.value })} size="small" fullWidth slotProps={{ htmlInput: { maxLength: SPEC_VALUE_MAX * 2 } }} />
              <IconButton type="button" aria-label={`حذف ویژگی ${(i + 1).toLocaleString("fa-IR")}`} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} data-testid="spec-remove">
                ✕
              </IconButton>
            </Stack>
          ))}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
            <Button type="button" size="small" variant="outlined" onClick={() => setRows((rs) => [...rs, withId({ label: "", value: "" })])} disabled={rows.length >= MAX_SPEC_ROWS} data-testid="spec-add">
              افزودن ویژگی
            </Button>
            <TextField select size="small" label="افزودن از پیش‌فرض (اختیاری)" value="" onChange={(e) => addPreset(e.target.value)} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} sx={{ minWidth: 220 }} data-testid="spec-preset">
              <option value="">—</option>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary">
              حداکثر {MAX_SPEC_ROWS.toLocaleString("fa-IR")} ویژگی. ردیف‌هایی که مقدار ندارند ذخیره نمی‌شوند.
            </Typography>
          </Stack>
        </>
      )}
    </Stack>
  );
}
