import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import SmsSettings from "@/components/orders/SmsSettings";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "پیامک سفارش" };

export default async function SmsPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>پیامک سفارش</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        خریدار هنگام ثبت، ارسال و لغو سفارش پیامک می‌گیرد و شما برای هر سفارش تازه. پیامک‌ها از طرف سایت‌ساز فرستاده می‌شوند.
      </Typography>
      <SmsSettings storeId={storeId} />
    </Box>
  );
}
