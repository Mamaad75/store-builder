import { khanehTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitTemplate } from "../kit/kit";
import s from "./khaneh.module.css";

/** The `khaneh` theme, version 1: kit components (shared, accessible) styled by its own CSS module. */
export const khanehTemplate = createKitTemplate(khanehTheme, s, {
  card: {category: true, cta: null},
  headerCategories: true,
});
