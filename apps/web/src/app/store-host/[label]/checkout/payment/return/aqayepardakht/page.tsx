import PaymentReturn from "@/components/shop/PaymentReturn";
import { ShopPage, shopMetadata } from "../../../../_shop";

export const dynamic = "force-dynamic";
export const metadata = { ...shopMetadata("نتیجه‌ی پرداخت"), referrer: "no-referrer" as const };

/**
 * D35c-1: where Aghaye Pardakht sends the buyer back (callback_method GET: ?transid=...&status=1|0&tracking_number=...). Only transid and
 * status are forwarded to the server, which verifies the payment itself; the other parameters are not trusted and not used.
 */
export default async function AqayePardakhtReturnPage({ params, searchParams }: { params: Promise<{ label: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  return (
    <ShopPage params={params}>
      <PaymentReturn gateway="AQAYEPARDAKHT" authority={one(q.transid)} status={one(q.status)} />
    </ShopPage>
  );
}
