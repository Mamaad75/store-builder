import CartView from "@/components/shop/CartView";
import { ShopPage, shopMetadata } from "../_shop";

export const dynamic = "force-dynamic";
export const metadata = shopMetadata("سبد خرید");

export default function CartPage({ params }: { params: Promise<{ label: string }> }) {
  return (
    <ShopPage params={params}>
      <CartView />
    </ShopPage>
  );
}
