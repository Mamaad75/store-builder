import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AddRounded from "@mui/icons-material/AddRounded";
import ImageOutlined from "@mui/icons-material/ImageOutlined";
import ViewAgendaOutlined from "@mui/icons-material/ViewAgendaOutlined";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { LinkButton } from "@/components/NextLinks";
import StoreSetupChecklist from "@/components/StoreSetupChecklist";
import StoreAnalytics from "@/components/orders/StoreAnalytics";
import StoreOverview from "@/components/orders/StoreOverview";
import { StoreLogoUploader } from "@/components/BoundForms";
import { mediaPublicUrl } from "@/lib/media-url";
import { BusinessCategoryForm, DeleteStoreForm, StoreSettingsForm } from "@/components/StoreForms";
import { pageUrl } from "@store-builder/shared/modules/pages/urls";
import { BUSINESS_CATEGORIES } from "@store-builder/shared/lib/business-categories";
import { requireUser } from "@/modules/auth/session";
import { NotFoundError } from "@store-builder/shared/modules/stores/errors";
import { getStore } from "@/gateway/stores";
import { templateSettingsSchema } from "@store-builder/shared/templates/sections";

function safeUrl(key: string): string | null {
  try {
    return mediaPublicUrl(key);
  } catch {
    return null;
  }
}

export const metadata: Metadata = { title: "تنظیمات فروشگاه" };

export default async function StorePage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  let store;
  try {
    store = await getStore(storeId); // ownership enforced here: missing and foreign are both 404
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const settings = templateSettingsSchema.parse(store.settings);
  return (
    <Stack spacing={3}>
    {/* M2: sales overview, action items and low stock (owner and manager; hidden for other roles) */}
    <StoreSetupChecklist storeId={store.id} />
    <StoreAnalytics storeId={store.id} />
    <StoreOverview storeId={store.id} />
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 } }}>
      <Stack spacing={4}>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1.5 }}>
          <LinkButton href={pageUrl(store.id, "HOME")} variant="contained" startIcon={<ViewAgendaOutlined />}>ویرایش بخش‌های صفحهٔ خانه</LinkButton>
          <LinkButton href="#store-brand" variant="outlined" startIcon={<ImageOutlined />}>بارگذاری لوگو</LinkButton>
          <LinkButton href={`/dashboard/stores/${encodeURIComponent(store.id)}/products/new`} variant="outlined" startIcon={<AddRounded />}>افزودن محصول</LinkButton>
        </Stack>
        <StoreSettingsForm store={{ id: store.id, name: store.name, primaryColor: settings.primaryColor, contact: settings.contact, social: settings.social, description: settings.description }} />
        <Divider />
        <BusinessCategoryForm storeId={store.id} current={store.businessCategory} categories={BUSINESS_CATEGORIES.map((c) => ({ key: c.key, name: c.name }))} />
        <Divider />
        <section id="store-brand" style={{ scrollMarginTop: 96 }}>
          <StoreLogoUploader
            title="لوگوی فروشگاه"
            help="JPEG، PNG یا WebP؛ حداکثر ۵ مگابایت. لوگو در سربرگ فروشگاه نمایش داده می‌شود. هر کسی که نشانی تصویر را داشته باشد می‌تواند آن را ببیند؛ فایل خصوصی بارگذاری نکنید."
            testId="store-logo"
            hidden={{ storeId: store.id }}
            imageUrl={store.logo ? safeUrl(store.logo.key) : null}
            image={store.logo?.width && store.logo.height ? { width: store.logo.width, height: store.logo.height } : null}
          />
        </section>
        <Divider />
        <DeleteStoreForm storeId={store.id} storeName={store.name} />
      </Stack>
    </Paper>
    </Stack>
  );
}
