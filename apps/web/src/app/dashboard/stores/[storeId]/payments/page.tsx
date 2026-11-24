import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import PaymentSettings from "@/components/orders/PaymentSettings";
import BankCardsEditor from "@/components/orders/BankCardsEditor";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "روش‌های پرداخت" };

export default async function PaymentsPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>روش‌های پرداخت</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        پرداخت در محل در «روش‌های ارسال» تنظیم می‌شود. اینجا پرداخت اینترنتی و کارت به کارت را فعال کنید؛ خریدار در صفحه‌ی خرید از بین روش‌های فعال انتخاب می‌کند.
      </Typography>
      <Box sx={{ display: "grid", gap: 3, maxWidth: 720 }}>
        <BankCardsEditor storeId={storeId} />
        <Box>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1 }}>پرداخت اینترنتی (درگاه‌ها)</Typography>
          <PaymentSettings storeId={storeId} />
        </Box>
      </Box>
    </Box>
  );
}
