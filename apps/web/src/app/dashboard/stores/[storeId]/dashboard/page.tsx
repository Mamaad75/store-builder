import type { Metadata } from "next";
import { requireUser } from "@/modules/auth/session";
import StoreSetupChecklist from "@/components/StoreSetupChecklist";
import StoreAnalytics from "@/components/orders/StoreAnalytics";
import StoreOverview from "@/components/orders/StoreOverview";
import Stack from "@mui/material/Stack";

export const metadata: Metadata = { title: "داشبورد" };

/**
 * The store's dashboard: what is missing before shoppers can order (setup checklist), the trend charts and the overview. The layout above
 * already refuses a store the user cannot see (404); each section asks the API itself and hides itself for roles without permission.
 */
export default async function StoreDashboardPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return (
    <Stack spacing={3}>
      <StoreSetupChecklist storeId={storeId} />
      <StoreAnalytics storeId={storeId} />
      <StoreOverview storeId={storeId} />
    </Stack>
  );
}
