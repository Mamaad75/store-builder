import type { StorefrontCategory, StorefrontProduct } from "../storefront-data";
import type { RenderContext } from "../types";
import { formatToman } from "@/lib/money";
import { formatNumberFa } from "@/lib/money";
import s from "./general.module.css";

/** Stock is shown independently of product status: a visible product with zero stock is "ناموجود", not hidden. */
export function StockBadge({ stock }: { stock: number }) {
  if (stock <= 0) return <span className={`${s.badge} ${s.outOfStock}`}>ناموجود</span>;
  if (stock <= 5) return <span className={`${s.badge} ${s.lowStock}`}>تنها {formatNumberFa(stock)} عدد باقی مانده</span>;
  return <span className={`${s.badge} ${s.inStock}`}>موجود</span>;
}

export const initial = (name: string) => Array.from(name.trim())[0] ?? "؟";

/** Product image from the contract (public URL built by the host), or the initial-letter placeholder. */
export function ProductArt({ product, ctx, eager = false }: { product: StorefrontProduct; ctx: RenderContext; eager?: boolean }) {
  const url = product.image ? ctx.mediaUrl(product.image.key) : null;
  if (!product.image || !url) return <>{initial(product.name)}</>;
  return (
    // Decorative in cards (the product name is the adjacent link text); descriptive on the detail page.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={s.img}
      src={url}
      alt={eager ? product.name : ""}
      width={product.image.width}
      height={product.image.height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      {...(eager ? { fetchPriority: "high" as const } : {})}
    />
  );
}

export default function ProductCard({ product, category, ctx }: { product: StorefrontProduct; category: StorefrontCategory | null; ctx: RenderContext }) {
  return (
    <li>
      <article className={s.card}>
        <div className={s.cardArt} aria-hidden={product.image ? undefined : "true"}>
          <ProductArt product={product} ctx={ctx} />
        </div>
        <div className={s.cardBody}>
          {category && <span className={s.cardCategory}>{category.name}</span>}
          <h3 style={{ fontSize: "1em" }}>
            <a className={s.cardName} href={ctx.href(`/products/${encodeURIComponent(product.slug)}`)}>
              {product.name}
            </a>
          </h3>
          <StockBadge stock={product.stockQuantity} />
          <p className={s.price}>{formatToman(product.price)}</p>
        </div>
      </article>
    </li>
  );
}
