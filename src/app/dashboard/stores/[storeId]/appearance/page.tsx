import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AppearanceForm from "@/components/pages/AppearanceForm";
import { requireUser } from "@/modules/auth/session";
import { NotFoundError } from "@/modules/stores/errors";
import { getStore } from "@/modules/stores/service";
import { templateSettingsSchema } from "@/templates/sections";

export const metadata: Metadata = { title: "ظاهر فروشگاه" };

export default async function AppearancePage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await requireUser();
  const { storeId } = await params;
  let store;
  try {
    store = await getStore(user.id, storeId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const settings = templateSettingsSchema.parse(store.settings);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 } }}>
      <Stack spacing={3}>
        <Typography variant="body2" color="text.secondary">
          رنگ و تایپوگرافی فروشگاه. تغییرات فقط روی پیش‌نویس اعمال می‌شود؛ از «پیش‌نمایش پیش‌نویس» آن را ببینید.
        </Typography>
        <AppearanceForm
          storeId={store.id}
          primaryColor={settings.primaryColor}
          sizeScale={settings.typography.sizeScale}
          headingWeight={settings.typography.headingWeight}
          bodyWeight={settings.typography.bodyWeight}
        />
      </Stack>
    </Paper>
  );
}
