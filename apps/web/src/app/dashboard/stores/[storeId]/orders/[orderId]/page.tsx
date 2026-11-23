import type { Metadata } from "next";
import Box from "@mui/material/Box";
import OrderDetail from "@/components/orders/OrderDetail";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "جزئیات سفارش" };

export default async function OrderPage({ params }: { params: Promise<{ storeId: string; orderId: string }> }) {
  await requireUser();
  const { storeId, orderId } = await params;
  return (
    <Box>
      <a href={`/dashboard/stores/${encodeURIComponent(storeId)}/orders`}>بازگشت به سفارش‌ها</a>
      <Box sx={{ mt: 2 }}><OrderDetail storeId={storeId} orderId={orderId} /></Box>
    </Box>
  );
}
