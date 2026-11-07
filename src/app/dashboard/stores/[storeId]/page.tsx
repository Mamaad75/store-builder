import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { removeStoreLogoAction, uploadStoreLogoAction } from "@/app/dashboard/media-actions";
import ImageUploader from "@/components/ImageUploader";
import { mediaPublicUrl } from "@/lib/storage";
import { DeleteStoreForm, StoreSettingsForm } from "@/components/StoreForms";
import { requireUser } from "@/modules/auth/session";
import { NotFoundError } from "@/modules/stores/errors";
import { getStore } from "@/modules/stores/service";
import { templateSettingsSchema } from "@/templates/sections";

function safeUrl(key: string): string | null {
  try {
    return mediaPublicUrl(key);
  } catch {
    return null;
  }
}

export const metadata: Metadata = { title: "تنظیمات فروشگاه" };

export default async function StorePage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await requireUser();
  const { storeId } = await params;
  let store;
  try {
    store = await getStore(user.id, storeId); // ownership enforced here: missing and foreign are both 404
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const settings = templateSettingsSchema.parse(store.settings);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 } }}>
      <Stack spacing={4}>
        <StoreSettingsForm store={{ id: store.id, name: store.name, primaryColor: settings.primaryColor, contact: settings.contact, social: settings.social }} />
        <Divider />
        <ImageUploader
          title="لوگوی فروشگاه"
          help="JPEG، PNG یا WebP؛ حداکثر ۵ مگابایت. لوگو در سربرگ فروشگاه نمایش داده می‌شود. هر کسی که نشانی تصویر را داشته باشد می‌تواند آن را ببیند؛ فایل خصوصی بارگذاری نکنید."
          testId="store-logo"
          hidden={{ storeId: store.id }}
          imageUrl={store.logo ? safeUrl(store.logo.key) : null}
          image={store.logo?.width && store.logo.height ? { width: store.logo.width, height: store.logo.height } : null}
          uploadAction={uploadStoreLogoAction}
          removeAction={removeStoreLogoAction}
        />
        <Divider />
        <DeleteStoreForm storeId={store.id} storeName={store.name} />
      </Stack>
    </Paper>
  );
}
