import type { TemplateModule } from "../types";
import Layout from "./Layout";
import { CallToAction, CategoryFilter, ContactInfo, FeaturedProducts, Hero, ImageText, ProductDetail, ProductGrid, RichText } from "./sections";

/** The `general` template, version 1: a neutral, responsive RTL storefront. */
export const generalTemplate: TemplateModule = {
  key: "general",
  version: 1,
  name: "عمومی",
  Layout,
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
};
