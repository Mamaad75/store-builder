import { notFound } from "next/navigation";
import MyOrder from "@/components/shop/MyOrder";
import { ShopPage, shopMetadata } from "../../../_shop";

export const dynamic = "force-dynamic";
export const metadata = shopMetadata("سفارش من");

export default async function MyOrderPage({ params }: { params: Promise<{ label: string; orderId: string }> }) {
  const { orderId } = await params;
  if (!/^[a-z0-9]{1,64}$/.test(orderId)) notFound();
  return (
    <ShopPage params={params}>
      <MyOrder orderId={orderId} />
    </ShopPage>
  );
}
