import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import ProductForm from "@/components/catalog/ProductForm";
import { requireUser } from "@/modules/auth/session";
import { listCategories } from "@/modules/categories/service";
import { NotFoundError } from "@/modules/stores/errors";

export const metadata: Metadata = { title: "افزودن محصول" };

export default async function NewProductPage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await requireUser();
  const { storeId } = await params;
  let categories;
  try {
    categories = await listCategories(user.id, storeId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 } }}>
      <Typography variant="h6" component="h2" gutterBottom sx={{ fontWeight: 700 }}>
        افزودن محصول
      </Typography>
      <ProductForm mode="create" storeId={storeId} categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
    </Paper>
  );
}
