import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import PlansManager from "@/components/platform/PlansManager";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "پلن‌های اشتراک" };

export default async function PlansPage() {
  await requireUser();
  return (
    <>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 800, mb: 1 }}>پلن‌های اشتراک</Typography>
      <PlansManager />
    </>
  );
}
