import { dookhtTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitTemplate } from "../kit/kit";
import s from "./dookht.module.css";

/** The `dookht` theme, version 1: kit components (shared, accessible) styled by its own CSS module. */
export const dookhtTemplate = createKitTemplate(dookhtTheme, s, {
  card: {category: false, cta: null},
  headerCategories: false,
  extras: {"dookht.sizeGuide": "sizeGuide"},
});
