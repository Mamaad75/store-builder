import { circuitTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitTemplate } from "../kit/kit";
import s from "./circuit.module.css";

/** The `circuit` theme, version 1: kit v2 components (shared, accessible) styled by its own CSS module. */
export const circuitTemplate = createKitTemplate(circuitTheme, s, {
  card: { category: true, cta: null },
  headerCategories: true,
  featured: "rail",
  heroAside: true,
});
