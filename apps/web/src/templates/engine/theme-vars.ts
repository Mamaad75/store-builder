import type { CSSProperties } from "react";
import type { PageType } from "../sections";
import type { StorefrontStore } from "../storefront-data";
import type { RenderContext } from "../types";
import { contrastRatio, readableTextOn } from "./color";

const SIZE_SCALE = { small: 0.92, normal: 1, large: 1.1 } as const;

/**
 * The CSS custom properties every theme root sets from the store settings: brand color (+ readable text color and an
 * accessible accent for text on light backgrounds) and the closed typography choices (size percent, weights).
 * Only values from the validated contract reach CSS; nothing here is user-defined free text.
 */
export function themeStyleVars(store: StorefrontStore): CSSProperties {
  const primary = store.primaryColor;
  const t = store.typography;
  return {
    fontSize: `${Math.round(SIZE_SCALE[t.sizeScale] * 100)}%`,
    "--w-heading": String(t.headingWeight),
    "--w-body": String(t.bodyWeight),
    "--primary": primary,
    "--on-primary": readableTextOn(primary),
    "--accent": contrastRatio(primary, "#ffffff") >= 4.5 ? primary : "#1f2937",
  } as CSSProperties;
}

const NAV: { type: PageType; path: string }[] = [
  { type: "HOME", path: "/" },
  { type: "PRODUCTS", path: "/products" },
  { type: "ABOUT", path: "/about" },
  { type: "CONTACT", path: "/contact" },
];

/** Visible pages that belong in the main navigation, with their fixed public paths. */
export function navItems(ctx: RenderContext): { type: PageType; path: string; title: string; current: boolean }[] {
  const current = ctx.page.type === "PRODUCT_DETAIL" ? "PRODUCTS" : ctx.page.type;
  return NAV.flatMap((n) => {
    const page = ctx.data.pages.find((p) => p.type === n.type);
    return page ? [{ ...n, title: page.title, current: current === n.type }] : [];
  });
}
