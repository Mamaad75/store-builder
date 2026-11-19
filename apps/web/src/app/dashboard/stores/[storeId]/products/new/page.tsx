import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import ProductForm from "@/components/catalog/ProductForm";
import { requireUser } from "@/modules/auth/session";
import { getBusinessCategory } from "@/lib/business-categories";
import { listSpecPresets } from "@/lib/spec-presets";
import { listCategories } from "@/modules/categories/service";
import { getStore } from "@/modules/stores/service";
import { NotFoundError } from "@/modules/stores/errors";

export const metadata: Metadata = { title: "افزودن محصول" };

export default async function NewProductPage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await requireUser();
  const { storeId } = await params;
  let categories, store;
  try {
    [categories, store] = await Promise.all([listCategories(user.id, storeId), getStore(user.id, storeId)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 } }}>
      <Typography variant="h6" component="h2" gutterBottom sx={{ fontWeight: 700 }}>
        افزودن محصول
      </Typography>
      <ProductForm
        mode="create"
        storeId={storeId}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        presets={listSpecPresets(getBusinessCategory(store.businessCategory)?.suggestedSpecPresets).map((p) => ({ key: p.key, name: p.name, labels: [...p.labels] }))}
      />
    </Paper>
  );
}
