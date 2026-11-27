import type { RenderContext } from "@store-builder/shared/templates/context-types";
import ShopLinks from "./ShopLinks";

/** The header's account and cart icons: only on the LIVE store (previews and theme demos have nothing to buy). Every theme's header uses it. */
export default function ShopNav({ ctx }: { ctx: RenderContext }) {
  if (!ctx.commerce) return null;
  return <ShopLinks accountHref={ctx.href("/account")} cartHref={ctx.href("/cart")} checkoutHref={ctx.href("/checkout")} productsHref={ctx.href("/products")} />;
}
