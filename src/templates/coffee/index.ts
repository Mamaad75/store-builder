import type { TemplateModule } from "../types";
import { coffeeTheme } from "./definition";
import Layout from "./Layout";
import { CallToAction, CategoryFilter, ContactInfo, FeaturedProducts, Hero, ImageText, OpeningHours, ProductDetail, ProductGrid, RichText } from "./sections";

/** The `coffee` theme, version 1: warm, editorial, menu-style product rows (independent of the "coffee" business category). */
export const coffeeTemplate: TemplateModule = {
  definition: coffeeTheme,
  key: coffeeTheme.key,
  version: coffeeTheme.version,
  name: coffeeTheme.meta.name,
  Layout,
  editor: coffeeTheme.editor,
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
  extraSections: { "coffee.openingHours": OpeningHours },
};
