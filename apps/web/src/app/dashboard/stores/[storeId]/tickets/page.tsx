import type { Metadata } from "next";
import TicketCenter from "@/components/support/TicketCenter";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "درخواست پشتیبانی" };

export default async function TicketsPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return <TicketCenter storeId={storeId} />;
}
