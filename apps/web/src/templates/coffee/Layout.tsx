import { buildContactLinks } from "../engine/links";
import { navItems, themeStyleVars } from "../engine/theme-vars";
import type { LayoutProps } from "../types";
import s from "./coffee.module.css";

export const initial = (name: string) => Array.from(name.trim())[0] ?? "؟";

export default function Layout({ ctx, children }: LayoutProps) {
  const { store } = ctx.data;
  const links = buildContactLinks(store.contact, store.social);
  const logoUrl = store.logo ? ctx.mediaUrl(store.logo.key) : null;
  return (
    <div className={s.root} dir={store.direction} lang={store.direction === "rtl" ? "fa" : "en"} style={themeStyleVars(store)} data-template="coffee">
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
              {navItems(ctx).map((n) => (
                <li key={n.type}>
                  <a className={s.navLink} href={ctx.href(n.path)} aria-current={n.current ? "page" : undefined}>
                    {n.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" className={s.main} tabIndex={-1}>
        {children}
      </main>
      <footer className={s.footer}>
        <div className={s.container}>
          <p className={s.footerName}>{store.name}</p>
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
          <p className={s.copy}>© {store.name}</p>
        </div>
      </footer>
    </div>
  );
}
