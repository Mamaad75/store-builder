import type { Metadata } from "next";
import BillingView from "@/components/finance/BillingView";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "اشتراک" };

export default async function BillingPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return <BillingView storeId={storeId} />;
}
