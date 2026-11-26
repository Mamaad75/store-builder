import type { ReactNode } from "react";
import VisitBeacon from "@/components/shop/VisitBeacon";

/** Every page of a store's own host (storefront, cart, checkout, orders) counts one anonymous view for the merchant's charts. */
export default function StoreHostLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <VisitBeacon />
    </>
  );
}
