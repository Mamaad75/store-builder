import type { EditorSpec } from "../editor";

/** Approved sections per page for the `general` template. */
export const generalEditor: EditorSpec = {
  pages: {
    HOME: {
      allowed: ["hero", "featuredProducts", "imageText", "richText", "callToAction", "contactInfo"],
      singletons: ["hero"],
      required: [],
    },
    PRODUCTS: {
      allowed: ["categoryFilter", "productGrid", "richText", "callToAction"],
      singletons: ["categoryFilter", "productGrid"],
      required: ["productGrid"],
    },
    // The product page structure is fixed: it always shows exactly the product detail section.
    PRODUCT_DETAIL: { allowed: ["productDetail"], singletons: ["productDetail"], required: ["productDetail"] },
    ABOUT: { allowed: ["richText", "imageText", "callToAction", "contactInfo"], singletons: [], required: [] },
    CONTACT: { allowed: ["contactInfo", "richText", "callToAction"], singletons: ["contactInfo"], required: ["contactInfo"] },
  },
};
