import type { Metadata } from "next";
import WalletView from "@/components/finance/WalletView";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "کیف پول" };

export default async function WalletPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return <WalletView storeId={storeId} />;
}
