import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import PageContainer from "@/components/PageContainer";
import { CreateStoreForm } from "@/components/StoreForms";
import { BUSINESS_CATEGORIES } from "@store-builder/shared/lib/business-categories";
import { requireUser } from "@/modules/auth/session";
import { listActiveTemplates } from "@/gateway/stores";

export const metadata: Metadata = { title: "ساخت فروشگاه" };

export default async function NewStorePage({ searchParams }: { searchParams: Promise<{ theme?: string | string[] }> }) {
  await requireUser();
  const [templates, { theme }] = await Promise.all([listActiveTemplates(), searchParams]);
  const initialTheme = typeof theme === "string" && templates.some((template) => template.key === theme) ? theme : undefined;
  return (
    <PageContainer>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 }, mx: "auto", borderRadius: 4 }}>
        <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
          ساخت فروشگاه جدید
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          قالب را انتخاب کنید و نام فروشگاه را بنویسید. پس از ساخت، می‌توانید لوگو و محصولات را اضافه کنید.
        </Typography>
        <CreateStoreForm templates={templates} initialTheme={initialTheme} categories={BUSINESS_CATEGORIES.map((c) => ({ key: c.key, name: c.name, suggestedThemes: [...c.suggestedThemes] }))} />
      </Paper>
    </PageContainer>
  );
}
