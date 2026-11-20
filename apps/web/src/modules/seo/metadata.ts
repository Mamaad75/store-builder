import type { Metadata } from "next";
import { OG_LOCALE, canonicalUrl, pageDescription, pageTitle, shareImage, type SeoContext } from "@store-builder/shared/seo/metadata";

export function buildMetadata(ctx: SeoContext, baseUrl: string): Metadata {
  const title = pageTitle(ctx);
  const description = pageDescription(ctx);
  const url = canonicalUrl(ctx, baseUrl);
  const image = shareImage(ctx);
  return {
    title: { absolute: title }, // never the platform's "| سایت‌ساز فروشگاهی" suffix
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      url,
      title,
      description,
      siteName: ctx.data.store.name,
      locale: OG_LOCALE,
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [{ url: image.url, alt: image.alt }] } : {}),
    },
  };
}
