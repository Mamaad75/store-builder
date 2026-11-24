import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import PaymentSettings from "@/components/orders/PaymentSettings";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "پرداخت آنلاین" };

export default async function PaymentsPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>پرداخت آنلاین (زرین‌پال)</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        پول هر سفارش مستقیم به حساب زرین‌پال خودِ شما واریز می‌شود. مرچنت‌کد درگاهتان را وارد کنید تا خریداران بتوانند آنلاین پرداخت کنند.
      </Typography>
      <PaymentSettings storeId={storeId} />
    </Box>
  );
}
