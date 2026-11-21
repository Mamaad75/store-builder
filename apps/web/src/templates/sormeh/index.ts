import { sormehTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitTemplate } from "../kit/kit";
import s from "./sormeh.module.css";

/** The `sormeh` theme, version 1: kit components (shared, accessible) styled by its own CSS module. */
export const sormehTemplate = createKitTemplate(sormehTheme, s, {
  card: {category: true, cta: {kind: "details", label: "مشاهده محصول"}},
  headerCategories: false,
});
