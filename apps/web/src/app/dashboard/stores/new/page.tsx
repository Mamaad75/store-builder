import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import PageContainer from "@/components/PageContainer";
import { CreateStoreForm } from "@/components/StoreForms";
import { BUSINESS_CATEGORIES } from "@store-builder/shared/lib/business-categories";
import { requireUser } from "@/modules/auth/session";
import { listActiveTemplates } from "@/gateway/stores";

export const metadata: Metadata = { title: "ساخت فروشگاه" };

export default async function NewStorePage() {
  await requireUser();
  const templates = await listActiveTemplates();
  return (
    <PageContainer>
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx: "auto" }}>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        ساخت فروشگاه جدید
      </Typography>
      <CreateStoreForm templates={templates} categories={BUSINESS_CATEGORIES.map((c) => ({ key: c.key, name: c.name, description: c.description, suggestedThemes: [...c.suggestedThemes] }))} />
    </Paper>
    </PageContainer>
  );
}
