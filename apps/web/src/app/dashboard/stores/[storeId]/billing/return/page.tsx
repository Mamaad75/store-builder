import type { Metadata } from "next";
import PlatformPaymentReturn from "@/components/finance/PlatformPaymentReturn";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "نتیجهٔ پرداخت", robots: { index: false } };

/** Where the gateway sends the buyer back (`?Authority=…&Status=OK|NOK`). The page only asks the server to verify; nothing is granted here. */
export default async function PaymentReturnPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const { storeId } = await params;
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return <PlatformPaymentReturn storeId={storeId} authority={one(q.Authority)} status={one(q.Status)} />;
}
