import { notFound } from "next/navigation";
import OrderTracker from "@/components/shop/OrderTracker";
import { ShopPage, shopMetadata } from "../../_shop";

export const dynamic = "force-dynamic";
export const metadata = { ...shopMetadata("پیگیری سفارش"), referrer: "no-referrer" as const };

/** The order link a shopper got when ordering (the token is the secret: never sent on as a referrer). */
export default async function OrderPage({ params }: { params: Promise<{ label: string; token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  return (
    <ShopPage params={params}>
      <OrderTracker token={token} />
    </ShopPage>
  );
}
