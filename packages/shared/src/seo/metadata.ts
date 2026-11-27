import { listProducts } from "../templates/engine/listing.js";
import type { RenderContext } from "../templates/context-types.js";
import { clip, cleanText } from "./text.js";

/**
 * Search and link-preview metadata of a PUBLISHED storefront page, built only from the validated snapshot data (the same
 * `RenderContext` the renderer uses). Pure: the public base URL (`<protocol>://<label>.<root>`) comes from configuration and
 * is passed in; nothing here reads a request header, a draft table or the network.
 */
export type SeoContext = Pick<RenderContext, "data" | "page" | "query" | "product"> & { blog?: RenderContext["blog"]; info?: RenderContext["info"]; mediaUrl: (key: string) => string | null };

export const OG_LOCALE = "fa_IR";
const faNumber = (n: number) => n.toLocaleString("fa-IR");

/** The canonical path (and query) of the page being rendered. Junk parameters never appear: only the parsed query does. */
export function canonicalPath(ctx: SeoContext): string {
  if (ctx.info) return `/info/${ctx.info.key}`;
  if (ctx.blog) return ctx.blog.view === "post" ? `/blog/${encodeURIComponent(ctx.blog.post.slug)}` : "/blog";
  switch (ctx.page.type) {
    case "HOME":
      return "/";
    case "ABOUT":
      return "/about";
    case "CONTACT":
      return "/contact";
    case "PRODUCT_DETAIL":
      return ctx.product ? `/products/${encodeURIComponent(ctx.product.slug)}` : "/products";
    case "PRODUCTS": {
      const list = listProducts(ctx as RenderContext);
      const q = new URLSearchParams();
      if (list.category) q.set("category", list.category.slug);
      // Search results (noindex) canonicalise to the listing they search; a sort never changes the canonical page.
      if (list.page > 1 && !list.q) q.set("page", String(list.page)); // the clamped page, so ?page=999 canonicalises to the last page
      const s = q.toString();
      return `/products${s ? `?${s}` : ""}`;
    }
  }
}

export function canonicalUrl(ctx: SeoContext, baseUrl: string): string {
  return `${baseUrl}${canonicalPath(ctx)}`;
}

/** First meaningful text of a page (hero subtitle, rich text, image+text), used when the owner wrote no description. */
function firstSectionText(ctx: SeoContext): string | null {
  const home = ctx.data.pages.find((p) => p.type === "HOME");
  for (const section of home?.sections ?? []) {
    const props = section.props as Record<string, unknown>;
    const candidate = section.type === "hero" ? props.subtitle : section.type === "richText" || section.type === "imageText" ? props.body : null;
    if (typeof candidate === "string" && cleanText(candidate).length >= 20) return candidate;
  }
  return null;
}

export function pageTitle(ctx: SeoContext): string {
  const name = ctx.data.store.name;
  if (ctx.info) return `${ctx.info.title} | ${name}`;
  if (ctx.blog) return `${ctx.blog.view === "post" ? ctx.blog.post.title : "وبلاگ"} | ${name}`;
  switch (ctx.page.type) {
    case "HOME":
      return name;
    case "PRODUCT_DETAIL":
      return ctx.product ? `${ctx.product.name} | ${name}` : name;
    case "PRODUCTS": {
      const list = listProducts(ctx as RenderContext);
      if (list.q) return `جستجوی «${list.q}» | ${name}`;
      const base = list.category ? list.category.name : ctx.page.title;
      return `${base}${list.page > 1 ? ` - صفحه ${faNumber(list.page)}` : ""} | ${name}`;
    }
    default:
      return `${ctx.page.title} | ${name}`;
  }
}

export function pageDescription(ctx: SeoContext): string {
  const { store } = ctx.data;
  const owner = store.description ? cleanText(store.description) : "";
  if (ctx.info) return clip(`${ctx.info.title} - ${store.name}`);
  if (ctx.blog?.view === "post") return clip(ctx.blog.post.excerpt || ctx.blog.post.body.replace(/^##\s+/gm, ""));
  if (ctx.blog) return clip(`وبلاگ ${store.name}${owner ? `. ${owner}` : ""}`);
  switch (ctx.page.type) {
    case "PRODUCT_DETAIL": {
      if (ctx.product && cleanText(ctx.product.description)) return clip(ctx.product.description);
      return clip(`${ctx.product?.name ?? ctx.page.title} - ${store.name}${owner ? `. ${owner}` : ""}`);
    }
    case "PRODUCTS": {
      const list = listProducts(ctx as RenderContext);
      const lead = list.category ? `${list.category.name}: ${faNumber(list.total)} محصول در ${store.name}` : `فهرست محصولات ${store.name}`;
      return clip(owner ? `${lead}. ${owner}` : lead);
    }
    case "HOME": {
      if (owner) return clip(owner);
      const text = firstSectionText(ctx);
      return clip(text ?? store.name);
    }
    default:
      return clip(owner ? `${ctx.page.title} - ${store.name}. ${owner}` : `${ctx.page.title} - ${store.name}`);
  }
}

export interface OgImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

/** The share image: the product photo on a product page, otherwise the store logo; none when neither is available. */
export function shareImage(ctx: SeoContext): OgImage | null {
  const ref = (ctx.page.type === "PRODUCT_DETAIL" ? ctx.product?.image : null) ?? ctx.data.store.logo;
  if (!ref) return null;
  const url = ctx.mediaUrl(ref.key);
  if (!url) return null;
  const alt = ctx.page.type === "PRODUCT_DETAIL" && ctx.product ? ctx.product.name : ctx.data.store.name;
  return { url, width: ref.width, height: ref.height, alt };
}
