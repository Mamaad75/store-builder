import { bazaarMarketTheme as definition } from "@store-builder/shared/templates/kit/themes";
import BazaarLayout from "./Layout";
import { CategoryFilter, CategoryRows, Featured, ProductDetail, ProductGrid } from "./catalog";
import { CallToAction, Categories, ContactInfo, Hero, Highlights, ImageText, Promos, RichText } from "./sections";
import type { TemplateModule } from "../types";

export const bazaarTemplateV3: TemplateModule = {
  definition,
  key: definition.key,
  version: definition.version,
  name: definition.meta.name,
  editor: definition.editor,
  Layout: BazaarLayout,
  sections: {
    hero: Hero, featuredProducts: Featured, categoryFilter: CategoryFilter, productGrid: ProductGrid,
    productDetail: ProductDetail, richText: RichText, imageText: ImageText, contactInfo: ContactInfo, callToAction: CallToAction,
  },
  extraSections: {
    "bazaar.categories": Categories,
    "bazaar.promos": Promos,
    "bazaar.categoryRows": CategoryRows,
    "bazaar.highlights": Highlights,
  },
};
