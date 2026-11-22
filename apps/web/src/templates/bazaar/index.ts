import { bazaarTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitVariants } from "../kit/kit";
import s from "./bazaar.module.css";

/** The `bazaar` theme, version 1: kit v2 components (shared, accessible) styled by its own CSS module. */
export const [bazaarTemplate, bazaarTemplateV2] = createKitVariants(bazaarTheme, s, {
  card: { category: true, cta: null },
  headerCategories: true,
  featured: "rail",
  heroAside: true,
});
