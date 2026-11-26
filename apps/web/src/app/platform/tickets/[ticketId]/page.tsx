import type { Metadata } from "next";
import { StaffTicketView } from "@/components/platform/StaffTickets";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "درخواست پشتیبانی" };

export default async function PlatformTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  await requireUser();
  const { ticketId } = await params;
  return <StaffTicketView ticketId={ticketId} />;
}
