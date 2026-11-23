import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import OrdersManager from "@/components/orders/OrdersManager";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "سفارش‌ها" };

export default async function OrdersPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>سفارش‌ها</Typography>
      <OrdersManager storeId={storeId} />
    </Box>
  );
}
