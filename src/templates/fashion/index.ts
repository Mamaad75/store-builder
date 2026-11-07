import type { TemplateModule } from "../types";
import { fashionTheme } from "./definition";
import Layout from "./Layout";
import { CallToAction, CategoryFilter, ContactInfo, FeaturedProducts, Hero, ImageText, ProductDetail, ProductGrid, RichText, SizeGuide } from "./sections";

/** The `fashion` theme, version 1: minimal, image-led, sharp edges (independent of the "fashion" business category). */
export const fashionTemplate: TemplateModule = {
  definition: fashionTheme,
  key: fashionTheme.key,
  version: fashionTheme.version,
  name: fashionTheme.meta.name,
  Layout,
  editor: fashionTheme.editor,
  sections: {
    hero: Hero,
    featuredProducts: FeaturedProducts,
    productGrid: ProductGrid,
    categoryFilter: CategoryFilter,
    productDetail: ProductDetail,
    richText: RichText,
    imageText: ImageText,
    contactInfo: ContactInfo,
    callToAction: CallToAction,
  },
  extraSections: { "fashion.sizeGuide": SizeGuide },
};
