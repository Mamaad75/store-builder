import { sofrehTheme } from "@store-builder/shared/templates/kit/themes";
import { createKitVariants } from "../kit/kit";
import s from "./sofreh.module.css";

/** The `sofreh` theme, version 1: kit v2 components (shared, accessible) styled by its own CSS module. */
export const [sofrehTemplate, sofrehTemplateV2] = createKitVariants(sofrehTheme, s, {
  card: { category: false, cta: { kind: "whatsapp", label: "سفارش در واتساپ" } },
  headerCategories: false,
  featured: "grid",
  extras: { "sofreh.menu": "lines", "sofreh.hours": "lines" },
});
