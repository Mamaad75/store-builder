"use client";

import { useActionState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { updateAppearanceAction, type EditorState } from "@/app/dashboard/pages-actions";
import ColorField from "@/components/ColorField";

const SIZES = [
  { value: "small", label: "کوچک" },
  { value: "normal", label: "معمولی" },
  { value: "large", label: "بزرگ" },
];
const HEADING_WEIGHTS = [
  { value: "600", label: "نیمه‌ضخیم (۶۰۰)" },
  { value: "700", label: "ضخیم (۷۰۰)" },
  { value: "800", label: "خیلی ضخیم (۸۰۰)" },
];
const BODY_WEIGHTS = [
  { value: "400", label: "معمولی (۴۰۰)" },
  { value: "500", label: "متوسط (۵۰۰)" },
];

export default function AppearanceForm({ storeId, primaryColor, sizeScale, headingWeight, bodyWeight }: { storeId: string; primaryColor: string; sizeScale: string; headingWeight: number; bodyWeight: number }) {
  const [state, act, pending] = useActionState<EditorState, FormData>(updateAppearanceAction, {});
  const fe = (k: string) => state.fieldErrors?.[k]?.[0];
  return (
    <form action={act}>
      <input type="hidden" name="storeId" value={storeId} />
      <Stack spacing={2.5}>
        {state.error && <Alert severity="error">{state.error}</Alert>}
        {state.success && <Alert severity="success">{state.success}</Alert>}
        <ColorField name="primaryColor" label="رنگ اصلی" defaultValue={primaryColor} error={!!fe("primaryColor")} />
        <Typography variant="body2" color="text.secondary">
          فونت فروشگاه وزیرمتن است. اندازه و ضخامت فقط از گزینه‌های زیر انتخاب می‌شود.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField select name="sizeScale" label="اندازهٔ متن" defaultValue={sizeScale} fullWidth error={!!fe("typography")} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
            {SIZES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </TextField>
          <TextField select name="headingWeight" label="ضخامت عنوان‌ها" defaultValue={String(headingWeight)} fullWidth slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
            {HEADING_WEIGHTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </TextField>
          <TextField select name="bodyWeight" label="ضخامت متن" defaultValue={String(bodyWeight)} fullWidth slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
            {BODY_WEIGHTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </TextField>
        </Stack>
        <Stack direction="row">
          <Button type="submit" variant="contained" disabled={pending}>
            ذخیرهٔ ظاهر
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}
