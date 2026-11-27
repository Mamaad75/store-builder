import type { Metadata } from "next";
import StaffBilling from "@/components/platform/StaffBilling";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "مالی فروشگاه" };

export default async function StoreBillingPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return <StaffBilling storeId={storeId} />;
}
