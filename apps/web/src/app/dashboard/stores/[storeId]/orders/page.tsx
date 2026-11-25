import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import OrdersManager from "@/components/orders/OrdersManager";
import { requireUser } from "@/modules/auth/session";
import { ORDER_STATUSES, type OrderStatus } from "@store-builder/shared/modules/orders/orders";

export const metadata: Metadata = { title: "سفارش‌ها" };

export default async function OrdersPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const { storeId } = await params;
  const q = await searchParams;
  const c = q.customer;
  // M2: the overview links here with ?status=PLACED (to confirm) or CONFIRMED (to ship); anything else is ignored.
  const initialStatus = ORDER_STATUSES.find((x) => x === q.status) as OrderStatus | undefined;
  const initialReview = q.review === "receipt" ? ("receipt" as const) : undefined;
  const customerId = typeof c === "string" && /^[a-z0-9]{1,64}$/.test(c) ? c : undefined;
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>سفارش‌ها</Typography>
      <OrdersManager storeId={storeId} customerId={customerId} initialStatus={initialStatus} initialReview={initialReview} />
    </Box>
  );
}
