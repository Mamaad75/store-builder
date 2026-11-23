import { sormehTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitVariants } from "../kit/kit";
import s from "./sormeh.module.css";

/** The `sormeh` theme, version 1: kit v2 components (shared, accessible) styled by its own CSS module. */
export const [sormehTemplate, sormehTemplateV2] = createKitVariants(sormehTheme, s, {
  card: { category: true, cta: { kind: "details", label: "مشاهده محصول" } },
  headerCategories: false,
  featured: "rail",
});
