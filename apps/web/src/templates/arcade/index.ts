import { arcadeTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitTemplate } from "../kit/kit";
import s from "./arcade.module.css";

/** The `arcade` theme, version 1: kit components (shared, accessible) styled by its own CSS module. */
export const arcadeTemplate = createKitTemplate(arcadeTheme, s, {
  card: {category: true, cta: null},
  headerCategories: false,
  extras: {"arcade.steps": "steps"},
});
