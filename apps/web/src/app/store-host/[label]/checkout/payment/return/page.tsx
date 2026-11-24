import PaymentReturn from "@/components/shop/PaymentReturn";
import { ShopPage, shopMetadata } from "../../../_shop";

export const dynamic = "force-dynamic";
export const metadata = { ...shopMetadata("نتیجه‌ی پرداخت"), referrer: "no-referrer" as const };

/**
 * Phase 3.5: where Zarinpal sends the buyer back (?Authority=...&Status=OK|NOK). The page only forwards the two values to the server, which
 * verifies the payment itself; nothing on this page decides that an order is paid.
 */
export default async function PaymentReturnPage({ params, searchParams }: { params: Promise<{ label: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  return (
    <ShopPage params={params} orderAccess>
      <PaymentReturn authority={one(q.Authority)} status={one(q.Status)} />
    </ShopPage>
  );
}
