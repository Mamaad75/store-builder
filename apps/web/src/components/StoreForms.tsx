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
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded";
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
export function CreateStoreForm({ templates, categories, initialTheme }: { templates: ThemeOption[]; categories: { key: string; name: string; suggestedThemes: string[] }[]; initialTheme?: string }) {
  const [state, action, pending] = useActionState(createStoreAction, {});
  const initialCategory = categories.find((c) => c.suggestedThemes[0] === initialTheme) ?? categories[0];
  const [category, setCategory] = useState(initialCategory?.key ?? "general");
  const [name, setName] = useState("");
  const [theme, setTheme] = useState(() => {
    const first = initialCategory?.suggestedThemes.find((k) => templates.some((t) => t.key === k));
    return initialTheme ?? first ?? templates[0]?.key ?? "";
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
        <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minInlineSize: 0 }}>
          <Typography component="legend" sx={{ mb: 0.5, fontWeight: 600 }}>
            چه چیزی می‌فروشید؟
          </Typography>
          <input type="hidden" name="businessCategory" value={category} />
          <Grid container spacing={2}>
            {categories.map((c) => (
              <Grid key={c.key} size={{ xs: 6, md: 3 }}>
                <Card variant="outlined" sx={{ ...choice(category === c.key), height: "100%", borderRadius: 2 }} data-category-key={c.key}>
                  <CardActionArea type="button" onClick={() => pickCategory(c.key)} aria-pressed={category === c.key} sx={{ height: "100%", px: 1.5, py: 1, textAlign: "start", bgcolor: category === c.key ? "action.selected" : undefined }}>
                    <Typography component="span" variant="body2" sx={{ fontWeight: 700 }}>{c.name}</Typography>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
          {fe(state, "businessCategory") && <Alert severity="error" sx={{ mt: 1 }}>{fe(state, "businessCategory")}</Alert>}
        </Box>
        <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minInlineSize: 0 }}>
          <Typography component="legend" sx={{ mb: 0.5, fontWeight: 600 }}>
            قالب فروشگاه
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            پیش‌نمایش قالب را باز کنید و چیدمان صفحات فروشگاه را ببینید.
          </Typography>
          <input type="hidden" name="templateKey" value={theme} />
          <Grid container spacing={2}>
            {templates.map((t) => (
              <Grid key={t.key} size={{ xs: 12, sm: 6, md: 3 }}>
                <Card variant="outlined" sx={{ ...choice(theme === t.key), height: "100%", borderRadius: 3, display: "flex", flexDirection: "column" }} data-theme-key={t.key}>
                  <CardActionArea type="button" onClick={() => setTheme(t.key)} aria-pressed={theme === t.key} aria-label={`انتخاب قالب ${t.name}`} sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "start" }}>
                    <Box component="span" sx={{ display: "block", position: "relative", aspectRatio: "16 / 10", bgcolor: "action.hover" }}>
                      {/* The local, fixed-size artwork is already optimised. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.key === "bazaar" ? "/theme-demos/bazaar-layout.webp" : `/theme-demos/${t.key}.webp`} alt="" width={t.key === "bazaar" ? 640 : 440} height={t.key === "bazaar" ? 400 : 440} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }} />
                      {theme === t.key && <CheckCircleRounded sx={{ position: "absolute", insetInlineStart: 10, top: 10, bgcolor: "background.paper", borderRadius: "50%", color: "primary.main" }} />}
                    </Box>
                    <CardContent component="span" sx={{ display: "block", p: 1.5 }}>
                      <Typography component="span" sx={{ display: "block", fontWeight: 800 }}>{t.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t.description}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                  <Button href={`/themes/${t.key}`} target="_blank" rel="noopener" aria-label={`پیش‌نمایش قالب ${t.name} (زبانهٔ جدید)`} endIcon={<OpenInNewRounded />} sx={{ alignSelf: "start", m: 0.5 }}>
                    پیش‌نمایش
                  </Button>
                </Card>
              </Grid>
            ))}
          </Grid>
          {fe(state, "templateKey") && <Alert severity="error" sx={{ mt: 1 }}>{fe(state, "templateKey")}</Alert>}
        </Box>
        <TextField name="name" label="نام فروشگاه" required value={name} onChange={(event) => setName(event.target.value)} error={!!fe(state, "name")} helperText={fe(state, "name")} />
        <Button type="submit" variant="contained" size="large" disabled={pending || !theme} sx={{ alignSelf: { sm: "start" } }}>
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
  description: string;
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
        <TextField
          name="description"
          label="توضیح کوتاه فروشگاه (برای موتورهای جستجو و پیش‌نمایش لینک)"
          defaultValue={store.description}
          multiline
          minRows={2}
          error={!!fe(state, "description")}
          helperText={fe(state, "description") ?? "حداکثر ۱۶۰ نویسه. اگر خالی بماند، از متن صفحهٔ اصلی ساخته می‌شود."}
          slotProps={{ htmlInput: { maxLength: 160 } }}
        />
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
