import type { Metadata } from "next";
import ReferralView from "@/components/finance/ReferralView";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "دعوت از دوستان" };

export default async function ReferralsPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return <ReferralView storeId={storeId} />;
}
