import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
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
  let product, categories;
  try {
    [product, categories] = await Promise.all([getProduct(user.id, storeId, productId), listCategories(user.id, storeId)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound(); // foreign and missing products look identical
    throw e;
  }
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
