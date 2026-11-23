import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CustomersManager from "@/components/orders/CustomersManager";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "مشتری‌ها" };

export default async function CustomersPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>مشتری‌ها</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        هر کسی که در فروشگاه ثبت‌نام کرده یا سفارش داده است. سفارش‌های بدون ورود با شمارهٔ موبایل به همان مشتری وصل می‌شوند.
      </Typography>
      <CustomersManager storeId={storeId} />
    </Box>
  );
}
