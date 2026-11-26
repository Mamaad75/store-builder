import type { Metadata } from "next";
import { requireUser } from "@/modules/auth/session";
import AuditLog from "@/components/team/AuditLog";

export const metadata: Metadata = { title: "گزارش فعالیت‌ها" };

/** The store's activity log (owner and manager). The API decides who may read it. */
export default async function ActivityPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireUser();
  const { storeId } = await params;
  return <AuditLog storeId={storeId} />;
}
