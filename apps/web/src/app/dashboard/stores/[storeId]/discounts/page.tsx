import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import DiscountsManager from "@/components/orders/DiscountsManager";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "کدهای تخفیف" };

export default async function DiscountsPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>کدهای تخفیف</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        خریدار کد را در صفحه‌ی خرید وارد می‌کند؛ در هر سفارش یک کد. تغییرها بدون انتشار، همان لحظه اعمال می‌شوند.
      </Typography>
      <DiscountsManager storeId={storeId} />
    </Box>
  );
}
