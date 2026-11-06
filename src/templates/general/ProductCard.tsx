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

export default function ProductCard({ product, category, ctx }: { product: StorefrontProduct; category: StorefrontCategory | null; ctx: RenderContext }) {
  return (
    <li>
      <article className={s.card}>
        <div className={s.cardArt} aria-hidden="true">
          {initial(product.name)}
        </div>
        <div className={s.cardBody}>
          {category && <span className={s.cardCategory}>{category.name}</span>}
          <h3 style={{ fontSize: "1rem" }}>
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
