import { dookhtTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitVariants } from "../kit/kit";
import s from "./dookht.module.css";

/** The `dookht` theme, version 1: kit v2 components (shared, accessible) styled by its own CSS module. */
export const [dookhtTemplate, dookhtTemplateV2] = createKitVariants(dookhtTheme, s, {
  card: { category: false, cta: null },
  headerCategories: false,
  featured: "rail",
  extras: { "dookht.sizeGuide": "sizeGuide" },
});
