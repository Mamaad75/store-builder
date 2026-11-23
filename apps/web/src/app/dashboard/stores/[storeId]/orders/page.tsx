import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import OrdersManager from "@/components/orders/OrdersManager";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "سفارش‌ها" };

export default async function OrdersPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const { storeId } = await params;
  const c = (await searchParams).customer;
  const customerId = typeof c === "string" && /^[a-z0-9]{1,64}$/.test(c) ? c : undefined;
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>سفارش‌ها</Typography>
      <OrdersManager storeId={storeId} customerId={customerId} />
    </Box>
  );
}
