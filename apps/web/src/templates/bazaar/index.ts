import { bazaarTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitTemplate } from "../kit/kit";
import s from "./bazaar.module.css";

/** The `bazaar` theme, version 1: kit v2 components (shared, accessible) styled by its own CSS module. */
export const bazaarTemplate = createKitTemplate(bazaarTheme, s, {
  card: { category: true, cta: null },
  headerCategories: true,
  featured: "rail",
  heroAside: true,
});
