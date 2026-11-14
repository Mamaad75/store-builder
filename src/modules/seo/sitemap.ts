import type { StorefrontData } from "@/templates/storefront-data";

/** Sitemap and robots.txt of a published store host. Pure; the base URL comes from configuration. */

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** The sitemap protocol allows at most 50,000 URLs per file; a store holds at most 500 products, so this is only a guard. */
export const SITEMAP_MAX_URLS = 50_000;

/** Public paths of everything indexable in the live version: its visible pages, its categories with products and every product. */
export function sitemapPaths(data: StorefrontData): string[] {
  const has = (t: string) => data.pages.some((p) => p.type === t);
  const paths: string[] = [];
  if (has("HOME")) paths.push("/");
  if (has("PRODUCTS")) {
    paths.push("/products");
    for (const c of data.categories) {
      if (data.products.some((p) => p.categoryId === c.id)) paths.push(`/products?category=${encodeURIComponent(c.slug)}`);
    }
  }
  if (has("ABOUT")) paths.push("/about");
  if (has("CONTACT")) paths.push("/contact");
  if (has("PRODUCT_DETAIL")) for (const p of data.products) paths.push(`/products/${encodeURIComponent(p.slug)}`);
  return paths.slice(0, SITEMAP_MAX_URLS);
}

/** `lastmod` is when this version went live: the content of every listed page can only have changed then. */
export function buildSitemapXml(data: StorefrontData, baseUrl: string, liveSince: Date): string {
  const lastmod = liveSince.toISOString();
  const urls = sitemapPaths(data).map((p) => `  <url><loc>${xmlEscape(baseUrl + p)}</loc><lastmod>${lastmod}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function buildStoreRobotsTxt(baseUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`;
}
