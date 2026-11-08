import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { removeProductImageAction, uploadProductImageAction } from "@/app/dashboard/media-actions";
import ImageUploader from "@/components/ImageUploader";
import { getBusinessCategory } from "@/lib/business-categories";
import { SPEC_PROBLEM_FA, analyzeSpecs, previewStoredSpecs } from "@/lib/product-specs";
import { listSpecPresets } from "@/lib/spec-presets";
import { mediaPublicUrl } from "@/lib/storage";
import DeleteProductButton from "@/components/catalog/DeleteProductButton";
import Notice from "@/components/catalog/Notice";
import ProductForm from "@/components/catalog/ProductForm";
import StatusButtons from "@/components/catalog/StatusButtons";
import StatusChip from "@/components/catalog/StatusChip";
import { requireUser } from "@/modules/auth/session";
import { listCategories } from "@/modules/categories/service";
import { getProduct } from "@/modules/products/service";
import type { ProductStatus } from "@/modules/products/status";
import { NotFoundError } from "@/modules/stores/errors";
import { getStore } from "@/modules/stores/service";

function safeUrl(key: string): string | null {
  try {
    return mediaPublicUrl(key);
  } catch {
    return null; // storage not configured: show the placeholder, never break the page
  }
}

export const metadata: Metadata = { title: "ویرایش محصول" };

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string; productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { storeId, productId } = await params;
  const raw = await searchParams;
  let product, categories, store;
  try {
    [product, categories, store] = await Promise.all([getProduct(user.id, storeId, productId), listCategories(user.id, storeId), getStore(user.id, storeId)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound(); // foreign and missing products look identical
    throw e;
  }
  const analysis = analyzeSpecs(product.specs);
  return (
    <Stack spacing={2}>
      <Notice code={raw.notice} />
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 } }}>
        <Stack spacing={3}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
                ویرایش محصول
              </Typography>
              <StatusChip status={product.status as ProductStatus} />
            </Stack>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5 }}>
              <StatusButtons storeId={storeId} productId={product.id} status={product.status as ProductStatus} returnTo="edit" />
            </Stack>
          </Stack>
          <ProductForm
            mode="edit"
            storeId={storeId}
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            product={{
              id: product.id,
              name: product.name,
              slug: product.slug,
              description: product.description,
              price: product.price,
              stockQuantity: product.stockQuantity,
              categoryId: product.categoryId,
            }}
            specs={
              analysis.ok
                ? { state: "valid", rows: analysis.rows }
                : { state: "invalid", problem: SPEC_PROBLEM_FA[analysis.reason], preview: previewStoredSpecs(product.specs) }
            }
            presets={listSpecPresets(getBusinessCategory(store.businessCategory)?.suggestedSpecPresets).map((pr) => ({ key: pr.key, name: pr.name, labels: [...pr.labels] }))}
          />
          <Divider />
          <ImageUploader
            title="تصویر محصول"
            help="JPEG، PNG یا WebP؛ حداکثر ۵ مگابایت. تصویر بهینه و به WebP تبدیل می‌شود و اطلاعات مکانی/دوربین آن حذف می‌شود. هر کسی که نشانی تصویر را داشته باشد می‌تواند آن را ببیند."
            testId="product-image"
            hidden={{ storeId, productId: product.id }}
            imageUrl={product.image ? safeUrl(product.image.key) : null}
            image={product.image?.width && product.image.height ? { width: product.image.width, height: product.image.height } : null}
            uploadAction={uploadProductImageAction}
            removeAction={removeProductImageAction}
          />
          <Divider />
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="body2" color="text.secondary">
              حذف محصول قابل بازگشت نیست؛ برای پنهان کردن موقت از «بایگانی» استفاده کنید.
            </Typography>
            <DeleteProductButton storeId={storeId} productId={product.id} productName={product.name} />
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
