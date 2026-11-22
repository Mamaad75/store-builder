import { golkhanehTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitTemplate } from "../kit/kit";
import s from "./golkhaneh.module.css";

/** The `golkhaneh` theme, version 1: kit v2 components (shared, accessible) styled by its own CSS module. */
export const golkhanehTemplate = createKitTemplate(golkhanehTheme, s, {
  card: { category: true, cta: null },
  headerCategories: false,
  featured: "grid",
  extras: { "golkhaneh.delivery": "notice" },
});
