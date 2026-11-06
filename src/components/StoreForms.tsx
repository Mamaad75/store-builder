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
  updateStoreAction,
  type StoreFormState,
} from "@/app/dashboard/actions";

const fe = (s: StoreFormState, k: string) => s.fieldErrors?.[k]?.[0];

export function CreateStoreForm({ templates }: { templates: { key: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createStoreAction, {});
  const [selected, setSelected] = useState(templates[0]?.key ?? "");
  return (
    <form action={action}>
      <Stack spacing={3}>
        {state.error && <Alert severity="error">{state.error}</Alert>}
        <TextField name="name" label="نام فروشگاه" required error={!!fe(state, "name")} helperText={fe(state, "name")} />
        <Box>
          <Typography sx={{ mb: 1, fontWeight: 600 }}>قالب فروشگاه</Typography>
          <input type="hidden" name="templateKey" value={selected} />
          <Grid container spacing={2}>
            {templates.map((t) => (
              <Grid key={t.key} size={{ xs: 12, sm: 4 }}>
                <Card variant="outlined" sx={{ borderColor: selected === t.key ? "primary.main" : "divider", borderWidth: 2 }}>
                  <CardActionArea onClick={() => setSelected(t.key)} aria-pressed={selected === t.key}>
                    <CardContent>
                      <Typography sx={{ fontWeight: 700 }}>{t.name}</Typography>
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
