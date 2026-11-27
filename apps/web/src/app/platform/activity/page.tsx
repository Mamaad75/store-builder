import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import ActivityLog from "@/components/platform/ActivityLog";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "گزارش فعالیت پلتفرم" };

export default async function PlatformActivityPage() {
  await requireUser();
  return (
    <>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 800, mb: 1 }}>گزارش فعالیت پلتفرم</Typography>
      <Typography sx={{ color: "text.secondary", mb: 2 }}>کارهای سوپرادمین‌ها: چه کسی، چه کاری و کِی. متن آزاد و یادداشت‌ها در این گزارش نمایش داده نمی‌شود.</Typography>
      <ActivityLog />
    </>
  );
}
