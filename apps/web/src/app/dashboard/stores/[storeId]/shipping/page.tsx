import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ShippingMethodsEditor from "@/components/orders/ShippingMethodsEditor";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "روش‌های ارسال" };

export default async function ShippingPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>روش‌های ارسال</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        خریدار در صفحهٔ خرید، روش‌هایی را می‌بیند که به استانِ او ارسال دارند. تغییرها بدون انتشار، همان لحظه اعمال می‌شوند.
      </Typography>
      <ShippingMethodsEditor storeId={storeId} />
    </Box>
  );
}
