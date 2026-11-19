import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CategoryManager from "@/components/catalog/CategoryManager";
import Notice from "@/components/catalog/Notice";
import { requireUser } from "@/modules/auth/session";
import { listCategories } from "@/modules/categories/service";
import { MAX_CATEGORIES_PER_STORE } from "@/modules/categories/schemas";
import { NotFoundError } from "@/modules/stores/errors";

export const metadata: Metadata = { title: "دسته‌بندی‌ها" };

export default async function CategoriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { storeId } = await params;
  const raw = await searchParams;
  let categories;
  try {
    categories = await listCategories(user.id, storeId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <Box>
      <Notice code={raw.notice} />
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
        دسته‌بندی‌ها
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        حداکثر {MAX_CATEGORIES_PER_STORE.toLocaleString("fa-IR")} دسته برای هر فروشگاه. آدرس (slug) دسته‌ها خودکار ساخته می‌شود.
      </Typography>
      <CategoryManager storeId={storeId} categories={categories.map((c) => ({ id: c.id, name: c.name, productCount: c._count.products }))} />
    </Box>
  );
}
