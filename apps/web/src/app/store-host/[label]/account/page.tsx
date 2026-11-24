import AccountView from "@/components/shop/AccountView";
import { ShopPage, shopMetadata } from "../_shop";

export const dynamic = "force-dynamic";
export const metadata = shopMetadata("حساب کاربری");

export default function AccountPage({ params }: { params: Promise<{ label: string }> }) {
  return (
    <ShopPage params={params} orderAccess>
      <AccountView />
    </ShopPage>
  );
}
