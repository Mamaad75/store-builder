import type { Metadata } from "next";
import TicketView from "@/components/support/TicketView";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "درخواست پشتیبانی" };

export default async function TicketPage({ params }: { params: Promise<{ storeId: string; ticketId: string }> }) {
  await requireUser();
  const { storeId, ticketId } = await params;
  return <TicketView storeId={storeId} ticketId={ticketId} />;
}
