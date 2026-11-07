import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import PageEditor from "@/components/pages/PageEditor";
import { mediaPublicUrl } from "@/lib/storage";
import { requireUser } from "@/modules/auth/session";
import { UnsupportedTemplateError } from "@/modules/pages/errors";
import { getPageEditor } from "@/modules/pages/service";
import { pageTypeFromSlug, pagesUrl } from "@/modules/pages/urls";
import { NotFoundError } from "@/modules/stores/errors";

export const metadata: Metadata = { title: "ویرایش صفحه" };

function safeUrl(key: string): string | null {
  try {
    return mediaPublicUrl(key);
  } catch {
    return null; // storage not configured: placeholders, never a broken page
  }
}

export default async function EditPagePage({ params }: { params: Promise<{ storeId: string; pageType: string }> }) {
  const user = await requireUser();
  const { storeId, pageType } = await params;
  let view;
  try {
    view = await getPageEditor(user.id, storeId, pageTypeFromSlug(pageType)); // foreign/missing store and unknown page: the same 404
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof UnsupportedTemplateError) {
      return <Alert severity="info">ویرایش صفحه‌ها برای قالب این فروشگاه هنوز در دسترس نیست.</Alert>;
    }
    throw e;
  }
  const imageUrls: Record<string, { url: string; width: number; height: number }> = {};
  for (const [id, m] of Object.entries(view.images)) {
    const url = safeUrl(m.key);
    if (url) imageUrls[id] = { url, width: m.width, height: m.height };
  }
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          ویرایش صفحه: {view.title}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button component="a" href={pagesUrl(storeId)} size="small" variant="text">
            بازگشت به صفحه‌ها
          </Button>
          <Button component="a" href={`/preview/${encodeURIComponent(storeId)}${view.type === "HOME" ? "" : view.type === "PRODUCT_DETAIL" ? "/products" : `/${view.type.toLowerCase()}`}`} target="_blank" rel="noopener" size="small" variant="outlined">
            پیش‌نمایش
          </Button>
        </Stack>
      </Stack>
      <PageEditor
        storeId={storeId}
        pageType={view.type}
        title={view.title}
        revision={view.revision}
        isVisible={view.isVisible}
        canHide={view.canHide}
        sections={view.sections}
        dormant={view.dormant}
        issues={view.issues}
        archivedCount={view.archivedCount}
        allowed={[...view.rules.allowed]}
        singletons={[...view.rules.singletons]}
        required={[...view.rules.required]}
        maxSections={view.maxSections}
        imageUrls={imageUrls}
      />
    </Stack>
  );
}
