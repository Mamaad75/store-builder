import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import { StaffTicketList } from "@/components/platform/StaffTickets";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "درخواست‌های پشتیبانی" };

export default async function PlatformTicketsPage() {
  await requireUser();
  return (
    <>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 800, mb: 1 }}>درخواست‌های پشتیبانی</Typography>
      <Typography sx={{ color: "text.secondary", mb: 3 }}>درخواست فروشندگان؛ «در انتظار پشتیبانی» یعنی پاسخ شما لازم است.</Typography>
      <StaffTicketList />
    </>
  );
}
