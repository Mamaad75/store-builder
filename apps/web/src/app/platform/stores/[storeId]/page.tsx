import type { Metadata } from "next";
import StoreDetailView from "@/components/platform/StoreDetailView";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "جزئیات فروشگاه" };

export default async function StoreDetailPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return <StoreDetailView storeId={storeId} />;
}
