import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import type { RenderContext } from "../types";

/**
 * The extra images of a product (after the main one), as a small row of thumbnails under the main image on a product page.
 * Server-rendered, no script, inline styles so any theme's own image rules cannot stretch them. Nothing is rendered for a
 * product without extras, so existing pages are unchanged. Each image opens full size in the same tab (a plain link).
 */
export function GalleryStrip({ ctx, product }: { ctx: Pick<RenderContext, "mediaUrl">; product: Pick<StorefrontProduct, "name" | "gallery"> }) {
  const items = (product.gallery ?? []).map((ref) => ({ ref, url: ctx.mediaUrl(ref.key) })).filter((x): x is { ref: typeof x.ref; url: string } => Boolean(x.url));
  if (items.length === 0) return null;
  return (
    <ul aria-label={`تصاویر بیشتر ${product.name}`} data-gallery="" style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", margin: "12px 0 0", padding: 0 }}>
      {items.map(({ ref, url }, i) => (
        <li key={ref.key} style={{ margin: 0 }}>
          <a href={url} style={{ display: "block", width: 72, height: 72, minWidth: 44, minHeight: 44, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(128,128,128,.4)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${product.name} — تصویر ${(i + 2).toLocaleString("fa-IR")}`} width={72} height={72} loading="lazy" decoding="async" style={{ display: "block", width: 72, height: 72, objectFit: "cover" }} />
          </a>
        </li>
      ))}
    </ul>
  );
}
