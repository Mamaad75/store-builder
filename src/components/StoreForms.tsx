"use client";

import { useActionState, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ColorField from "@/components/ColorField";
import {
  createStoreAction,
  deleteStoreAction,
  updateBusinessCategoryAction,
  updateStoreAction,
  type StoreFormState,
} from "@/app/dashboard/actions";

const fe = (s: StoreFormState, k: string) => s.fieldErrors?.[k]?.[0];

interface ThemeOption {
  key: string;
  name: string;
  description: string;
}

/**
 * Two independent choices: what the merchant SELLS (business category: label + starter text) and the VISUAL THEME.
 * Choosing a category only suggests a theme; any combination can be created.
 */
export function CreateStoreForm({ templates, categories }: { templates: ThemeOption[]; categories: { key: string; name: string; description: string; suggestedThemes: string[] }[] }) {
  const [state, action, pending] = useActionState(createStoreAction, {});
  const [category, setCategory] = useState(categories[0]?.key ?? "general");
  const [theme, setTheme] = useState(() => {
    const first = categories[0]?.suggestedThemes.find((k) => templates.some((t) => t.key === k));
    return first ?? templates[0]?.key ?? "";
  });
  const pickCategory = (key: string) => {
    setCategory(key);
    const suggested = categories.find((c) => c.key === key)?.suggestedThemes.find((k) => templates.some((t) => t.key === k));
    if (suggested) setTheme(suggested);
  };
  const choice = (selected: boolean) => ({ borderColor: selected ? "primary.main" : "divider", borderWidth: 2 });
  return (
    <form action={action}>
      <Stack spacing={3}>
        {state.error && <Alert severity="error">{state.error}</Alert>}
        <TextField name="name" label="نام فروشگاه" required error={!!fe(state, "name")} helperText={fe(state, "name")} />
        <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
          <Typography component="legend" sx={{ mb: 0.5, fontWeight: 600 }}>
            چه چیزی می‌فروشید؟
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            فقط متن اولیهٔ فروشگاه را تعیین می‌کند و بعداً قابل تغییر است.
          </Typography>
          <input type="hidden" name="businessCategory" value={category} />
          <Grid container spacing={2}>
            {categories.map((c) => (
              <Grid key={c.key} size={{ xs: 12, sm: 6, md: 3 }}>
                <Card variant="outlined" sx={choice(category === c.key)} data-category-key={c.key}>
                  <CardActionArea onClick={() => pickCategory(c.key)} aria-pressed={category === c.key}>
                    <CardContent>
                      <Typography sx={{ fontWeight: 700 }}>{c.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {c.description}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
          {fe(state, "businessCategory") && <Alert severity="error" sx={{ mt: 1 }}>{fe(state, "businessCategory")}</Alert>}
        </Box>
        <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
          <Typography component="legend" sx={{ mb: 0.5, fontWeight: 600 }}>
            ظاهر فروشگاه (قالب)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            هر قالب با هر نوع فروشگاهی کار می‌کند.
          </Typography>
          <input type="hidden" name="templateKey" value={theme} />
          <Grid container spacing={2}>
            {templates.map((t) => (
              <Grid key={t.key} size={{ xs: 12, sm: 4 }}>
                <Card variant="outlined" sx={choice(theme === t.key)} data-theme-key={t.key}>
                  <CardActionArea onClick={() => setTheme(t.key)} aria-pressed={theme === t.key}>
                    <CardContent>
                      <Typography sx={{ fontWeight: 700 }}>{t.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t.description}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
          {fe(state, "templateKey") && <Alert severity="error" sx={{ mt: 1 }}>{fe(state, "templateKey")}</Alert>}
        </Box>
        <Button type="submit" variant="contained" size="large" disabled={pending}>
          ساخت فروشگاه
        </Button>
      </Stack>
    </form>
  );
}

/** Metadata-only change: it does not touch content, colors, typography or products. */
export function BusinessCategoryForm({ storeId, current, categories }: { storeId: string; current: string; categories: { key: string; name: string }[] }) {
  const [state, action, pending] = useActionState(updateBusinessCategoryAction, {});
  const known = categories.some((c) => c.key === current);
  return (
    <form action={action}>
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="expected" value={current} />
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>
          دسته‌بندی کسب‌وکار
        </Typography>
        {state.error && <Alert severity="error">{state.error}</Alert>}
        {state.success && <Alert severity="success">{state.success}</Alert>}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "flex-start" } }}>
          <TextField select name="businessCategory" label="چه چیزی می‌فروشید؟" defaultValue={current} size="small" sx={{ minWidth: 240 }} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
            {!known && <option value={current}>{current}</option>}
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </TextField>
          <Button type="submit" variant="outlined" size="small" disabled={pending}>
            ذخیرهٔ دسته‌بندی
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          فقط یک برچسب است: صفحه‌ها، محصولات، رنگ‌ها و قالب تغییری نمی‌کنند.
        </Typography>
      </Stack>
    </form>
  );
}

export interface StoreSettingsValues {
  id: string;
  name: string;
  primaryColor: string;
  contact: { phone: string; email: string; address: string };
  social: { instagram: string; telegram: string; whatsapp: string };
}

export function StoreSettingsForm({ store }: { store: StoreSettingsValues }) {
  const [state, action, pending] = useActionState(updateStoreAction, {});
  const ltr = { htmlInput: { dir: "ltr" as const } };
  return (
    <form action={action}>
      <input type="hidden" name="storeId" value={store.id} />
      <Stack spacing={2}>
        {state.error && <Alert severity="error">{state.error}</Alert>}
        {state.success && <Alert severity="success">{state.success}</Alert>}
        <TextField name="name" label="نام فروشگاه" defaultValue={store.name} required error={!!fe(state, "name")} helperText={fe(state, "name")} />
        <ColorField name="primaryColor" label="رنگ اصلی" defaultValue={store.primaryColor} error={!!fe(state, "primaryColor")} />
        <Typography sx={{ fontWeight: 700, pt: 1 }}>اطلاعات تماس</Typography>
        <TextField name="phone" label="تلفن" defaultValue={store.contact.phone} slotProps={ltr} />
        <TextField name="email" label="ایمیل" defaultValue={store.contact.email} slotProps={ltr} />
        <TextField name="address" label="آدرس" defaultValue={store.contact.address} multiline minRows={2} />
        <Typography sx={{ fontWeight: 700, pt: 1 }}>شبکه‌های اجتماعی</Typography>
        <TextField name="instagram" label="اینستاگرام (نام کاربری)" defaultValue={store.social.instagram} slotProps={ltr} error={!!fe(state, "social")} />
        <TextField name="telegram" label="تلگرام (نام کاربری)" defaultValue={store.social.telegram} slotProps={ltr} />
        <TextField name="whatsapp" label="واتساپ (شماره)" defaultValue={store.social.whatsapp} slotProps={ltr} />
        <Box>
          <Button type="submit" variant="contained" disabled={pending}>
            ذخیره تغییرات
          </Button>
        </Box>
      </Stack>
    </form>
  );
}

export function DeleteStoreForm({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [state, action, pending] = useActionState(deleteStoreAction, {});
  const [typed, setTyped] = useState("");
  return (
    <form action={action}>
      <input type="hidden" name="storeId" value={storeId} />
      <Stack spacing={2}>
        <Typography color="error" sx={{ fontWeight: 700 }}>
          حذف فروشگاه
        </Typography>
        <Typography variant="body2">
          با حذف فروشگاه، همه‌ی محصولات، صفحات و تصاویر آن برای همیشه پاک می‌شود. برای تأیید، نام فروشگاه (
          <strong>{storeName}</strong>) را تایپ کنید.
        </Typography>
        {state.error && <Alert severity="error">{fe(state, "confirmName") ?? state.error}</Alert>}
        <TextField name="confirmName" label="نام فروشگاه" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        <Box>
          <Button type="submit" color="error" variant="contained" disabled={pending || typed.trim() !== storeName}>
            حذف دائمی فروشگاه
          </Button>
        </Box>
      </Stack>
    </form>
  );
}
