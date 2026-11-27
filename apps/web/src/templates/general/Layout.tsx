import type { CSSProperties } from "react";
import { buildContactLinks } from "@store-builder/shared/templates/engine/links";
import { contrastRatio, readableTextOn } from "@store-builder/shared/templates/engine/color";
import type { LayoutProps } from "../types";
import { initial } from "./ProductCard";
import s from "./general.module.css";
import ShopNav from "../commerce/ShopNav";
import EnamadSeal from "../common/EnamadSeal";

const SIZE_SCALE = { small: 0.92, normal: 1, large: 1.1 } as const;

const NAV: { type: "HOME" | "PRODUCTS" | "ABOUT" | "CONTACT"; path: string }[] = [
  { type: "HOME", path: "/" },
  { type: "PRODUCTS", path: "/products" },
  { type: "ABOUT", path: "/about" },
  { type: "CONTACT", path: "/contact" },
];

export default function Layout({ ctx, children }: LayoutProps) {
  const { store, pages } = ctx.data;
  const primary = store.primaryColor;
  // Text/links drawn on white must stay readable even for a light brand color.
  const accent = contrastRatio(primary, "#ffffff") >= 4.5 ? primary : "#1f2937";
  const t = store.typography;
  const vars = {
    fontSize: `${Math.round(SIZE_SCALE[t.sizeScale] * 100)}%`,
    "--w-heading": String(t.headingWeight),
    "--w-body": String(t.bodyWeight),
    "--primary": primary,
    "--on-primary": readableTextOn(primary),
    "--accent": accent,
    "--primary-soft": `color-mix(in srgb, ${primary} 12%, white)`,
  } as CSSProperties;
  const logoUrl = store.logo ? ctx.mediaUrl(store.logo.key) : null;
  const links = buildContactLinks(store.contact, store.social);
  const nav: { type: string; path: string; title: string }[] = NAV.filter((n) => pages.some((p) => p.type === n.type)).map((n) => ({ ...n, title: pages.find((p) => p.type === n.type)!.title }));
  // The blog is a link only when the store has published posts.
  if ((ctx.data.posts?.length ?? 0) > 0) nav.push({ type: "BLOG", path: "/blog", title: "وبلاگ" });
  const currentType = ctx.blog ? "BLOG" : ctx.info ? "INFO" : ctx.page.type === "PRODUCT_DETAIL" ? "PRODUCTS" : ctx.page.type;

  return (
    <div className={s.root} dir={store.direction} lang={store.direction === "rtl" ? "fa" : "en"} style={vars} data-template="general">
      <a className={s.skip} href="#main">
        رفتن به محتوا
      </a>
      <header className={s.header}>
        <div className={`${s.container} ${s.headerInner}`}>
          <a className={s.brand} href={ctx.href("/")}>
            {logoUrl && store.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={s.logo} src={logoUrl} alt="" width={store.logo.width} height={store.logo.height} decoding="async" />
            ) : (
              <span className={s.brandMark} aria-hidden="true">
                {initial(store.name)}
              </span>
            )}
            {store.name}
          </a>
          <nav className={s.nav} aria-label="منوی اصلی">
            <ul>
              {nav.map((n) => (
                <li key={n.type}>
                  <a className={s.navLink} href={ctx.href(n.path)} aria-current={currentType === n.type ? "page" : undefined}>
                    {n.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <ShopNav ctx={ctx} />
        </div>
      </header>
      <main id="main" className={s.main} tabIndex={-1}>
        {children}
      </main>
      <footer className={s.footer}>
        <div className={s.container}>
          <div className={s.footerInner}>
            <div>
              <p className={s.footerName}>{store.name}</p>
            </div>
            {links.length > 0 && (
              <ul className={s.footerLinks} aria-label="راه‌های ارتباطی">
                {links.map((l) => (
                  <li key={l.kind}>
                    {l.href ? (
                      <a href={l.href} rel={l.href.startsWith("http") ? "noopener noreferrer" : undefined} target={l.href.startsWith("http") ? "_blank" : undefined}>
                        {l.label}
                      </a>
                    ) : (
                      <span>{l.value}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className={s.copy}>© {store.name}</p>
        </div>
        <div className={s.container}><EnamadSeal enamad={store.enamad} /></div>
      </footer>
    </div>
  );
}
