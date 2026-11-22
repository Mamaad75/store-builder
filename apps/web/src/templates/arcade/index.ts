import { arcadeTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitVariants } from "../kit/kit";
import s from "./arcade.module.css";

/** The `arcade` theme, version 1: kit v2 components (shared, accessible) styled by its own CSS module. */
export const [arcadeTemplate, arcadeTemplateV2] = createKitVariants(arcadeTheme, s, {
  card: { category: true, cta: null },
  headerCategories: false,
  featured: "rail",
  heroAside: true,
  extras: { "arcade.steps": "steps" },
});
