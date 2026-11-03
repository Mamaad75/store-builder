import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { CreateStoreForm } from "@/components/StoreForms";
import { requireUser } from "@/modules/auth/session";
import { listActiveTemplates } from "@/modules/stores/service";

export const metadata: Metadata = { title: "ساخت فروشگاه" };

export default async function NewStorePage() {
  await requireUser();
  const templates = await listActiveTemplates();
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 }, maxWidth: 800 }}>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        ساخت فروشگاه جدید
      </Typography>
      <CreateStoreForm templates={templates} />
    </Paper>
  );
}
