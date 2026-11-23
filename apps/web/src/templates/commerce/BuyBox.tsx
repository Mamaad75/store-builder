import type { RenderContext } from "@store-builder/shared/templates/context-types";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import AddToCart from "./AddToCart";

/**
 * The server half of "add to cart": shown only on the LIVE store (ctx.commerce), for a product that can be bought. Previews and theme
 * demos render nothing here. Every theme puts it in its product page's purchase area.
 */
export default function BuyBox({ ctx, product }: { ctx: RenderContext; product: StorefrontProduct }) {
  if (!ctx.commerce || product.stockQuantity <= 0) return null;
  const variants = product.variants.map((v) => ({ id: v.id, label: v.options.map((o) => o.value).join(" / "), inStock: v.stockQuantity > 0 }));
  return <AddToCart productId={product.id} productName={product.name} variants={variants} cartHref={ctx.href("/cart")} />;
}
