import { khanehTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitVariants } from "../kit/kit";
import s from "./khaneh.module.css";

/** The `khaneh` theme, version 1: kit v2 components (shared, accessible) styled by its own CSS module. */
export const [khanehTemplate, khanehTemplateV2] = createKitVariants(khanehTheme, s, {
  card: { category: true, cta: null },
  headerCategories: true,
  featured: "rail",
  heroAside: true,
});
