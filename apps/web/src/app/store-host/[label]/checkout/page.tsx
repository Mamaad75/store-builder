import { randomBytes } from "node:crypto";
import CheckoutForm from "@/components/shop/CheckoutForm";
import { ShopPage, shopMetadata } from "../_shop";

export const dynamic = "force-dynamic";
export const metadata = shopMetadata("تکمیل خرید");

export default function CheckoutPage({ params }: { params: Promise<{ label: string }> }) {
  // One key per checkout page: sending the order twice (double click, retry) returns the same order instead of a second one.
  const requestKey = randomBytes(18).toString("base64url");
  return (
    <ShopPage params={params}>
      <CheckoutForm requestKey={requestKey} />
    </ShopPage>
  );
}
