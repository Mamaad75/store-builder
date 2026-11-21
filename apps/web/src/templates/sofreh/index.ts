import { sofrehTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitTemplate } from "../kit/kit";
import s from "./sofreh.module.css";

/** The `sofreh` theme, version 1: kit components (shared, accessible) styled by its own CSS module. */
export const sofrehTemplate = createKitTemplate(sofrehTheme, s, {
  card: {category: false, cta: {kind: "whatsapp", label: "سفارش در واتساپ"}},
  headerCategories: false,
  extras: {"sofreh.menu": "lines", "sofreh.hours": "lines"},
});
