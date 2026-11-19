import { canonicalUrl, shareImage, type SeoContext } from "./metadata";
import { cleanText, clip } from "./text";

/**
 * Structured data (schema.org JSON-LD) of a published storefront page. Pure and built only from validated snapshot data.
 * Prices are stored in Toman; schema.org needs an ISO 4217 currency and Toman has none, so offers use IRR with the amount
 * converted to rials (1 Toman = 10 rials). The visible page keeps showing Toman.
 */
type Json = Record<string, unknown>;

const RIAL_PER_TOMAN = 10;
const SCHEMA = "https://schema.org";

/** Serialises for an inline `<script type="application/ld+json">`: nothing in the data can close the tag or start a comment. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Profile URLs for the social handles that look like real handles; anything else is left out (never guessed). */
export function socialProfileUrls(social: { instagram: string; telegram: string; whatsapp: string }): string[] {
  const out: string[] = [];
  const ig = social.instagram.replace(/^@/, "");
  if (/^[A-Za-z0-9._]{1,30}$/.test(ig)) out.push(`https://www.instagram.com/${encodeURIComponent(ig)}`);
  const tg = social.telegram.replace(/^@/, "");
  if (/^[A-Za-z0-9_]{3,64}$/.test(tg)) out.push(`https://t.me/${encodeURIComponent(tg)}`);
  const wa = social.whatsapp.replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (/^\d{6,20}$/.test(wa)) out.push(`https://wa.me/${wa}`);
  return out;
}

function organization(ctx: SeoContext, baseUrl: string): Json {
  const { store } = ctx.data;
  const logoRef = store.logo;
  const logo = logoRef ? ctx.mediaUrl(logoRef.key) : null;
  const sameAs = socialProfileUrls(store.social);
  const phone = cleanText(store.contact.phone);
  const email = cleanText(store.contact.email);
  const address = cleanText(store.contact.address);
  return {
    "@context": SCHEMA,
    "@type": "Organization",
    "@id": `${baseUrl}/#organization`,
    name: store.name,
    url: `${baseUrl}/`,
    ...(store.description ? { description: store.description } : {}),
    ...(logo ? { logo } : {}),
    ...(phone || email ? { contactPoint: { "@type": "ContactPoint", contactType: "customer service", ...(phone ? { telephone: phone } : {}), ...(email ? { email } : {}) } } : {}),
    ...(address ? { address: { "@type": "PostalAddress", streetAddress: address } } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

function website(ctx: SeoContext, baseUrl: string): Json {
  return { "@context": SCHEMA, "@type": "WebSite", "@id": `${baseUrl}/#website`, name: ctx.data.store.name, url: `${baseUrl}/`, inLanguage: "fa", publisher: { "@id": `${baseUrl}/#organization` } };
}

function breadcrumbs(ctx: SeoContext, baseUrl: string): Json {
  const product = ctx.product;
  const items = [
    { name: ctx.data.store.name, url: `${baseUrl}/` },
    { name: ctx.data.pages.find((p) => p.type === "PRODUCTS")?.title ?? "محصولات", url: `${baseUrl}/products` },
    ...(product ? [{ name: product.name, url: canonicalUrl(ctx, baseUrl) }] : []),
  ];
  return {
    "@context": SCHEMA,
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

function product(ctx: SeoContext, baseUrl: string): Json | null {
  const p = ctx.product;
  if (!p) return null;
  const image = shareImage(ctx);
  const category = p.categoryId ? ctx.data.categories.find((c) => c.id === p.categoryId) : undefined;
  const url = canonicalUrl(ctx, baseUrl);
  return {
    "@context": SCHEMA,
    "@type": "Product",
    name: p.name,
    url,
    ...(cleanText(p.description) ? { description: clip(p.description, 500) } : {}),
    ...(image && ctx.product?.image ? { image: [image.url] } : {}),
    ...(category ? { category: category.name } : {}),
    ...(p.specs.length > 0 ? { additionalProperty: p.specs.map((s) => ({ "@type": "PropertyValue", name: s.label, value: s.value })) } : {}),
    // A price of zero is not a price: no Offer is emitted rather than a misleading one.
    ...(p.price > 0
      ? {
          offers: {
            "@type": "Offer",
            url,
            priceCurrency: "IRR",
            price: String(p.price * RIAL_PER_TOMAN),
            availability: `${SCHEMA}/${p.stockQuantity > 0 ? "InStock" : "OutOfStock"}`,
            seller: { "@id": `${baseUrl}/#organization` },
          },
        }
      : {}),
  };
}

/** The JSON-LD documents of the page being rendered (home: Organization + WebSite; product: Product + BreadcrumbList). */
export function buildJsonLd(ctx: SeoContext, baseUrl: string): Json[] {
  switch (ctx.page.type) {
    case "HOME":
      return [organization(ctx, baseUrl), website(ctx, baseUrl)];
    case "PRODUCT_DETAIL": {
      const p = product(ctx, baseUrl);
      return p ? [p, breadcrumbs(ctx, baseUrl)] : [];
    }
    default:
      return [];
  }
}

