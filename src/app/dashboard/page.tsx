import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "داشبورد" };

// Placeholder: the real dashboard (stores list) arrives in later steps.
export default async function DashboardPage() {
  const user = await requireUser();
  return (
    <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>
      سلام {user.name}، به داشبورد خوش آمدید
    </Typography>
  );
}
