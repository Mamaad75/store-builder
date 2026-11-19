import type { TemplateModule } from "../types";
import { appliancesTheme } from "./definition";
import Layout from "./Layout";
import { CallToAction, CategoryFilter, ContactInfo, FeaturedProducts, Hero, ImageText, ProductDetail, ProductGrid, RichText, ServiceInfo } from "./sections";

/** The `appliances` theme, version 1: clean and technical, full-frame product images and spec tables (independent of the business category). */
export const appliancesTemplate: TemplateModule = {
  definition: appliancesTheme,
  key: appliancesTheme.key,
  version: appliancesTheme.version,
  name: appliancesTheme.meta.name,
  Layout,
  editor: appliancesTheme.editor,
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
  extraSections: { "appliances.serviceInfo": ServiceInfo },
};
