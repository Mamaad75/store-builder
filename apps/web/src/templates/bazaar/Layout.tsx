import { buildContactLinks } from "@store-builder/shared/templates/engine/links";
import { formTarget, listUrl } from "@store-builder/shared/templates/engine/listing";
import { SEARCH_MAX } from "@store-builder/shared/templates/engine/route";
import { navItems, themeStyleVars } from "../engine/theme-vars";
import { Icon } from "../kit/icons";
import type { LayoutProps } from "../types";
import s from "./market.module.css";
import ShopNav from "../commerce/ShopNav";
import EnamadSeal from "../common/EnamadSeal";

export default function BazaarLayout({ ctx, children }: LayoutProps) {
  const { store, categories } = ctx.data;
  const pages = navItems(ctx);
  const contacts = buildContactLinks(store.contact, store.social);
  const logo = store.logo && ctx.mediaUrl(store.logo.key);
  const search = formTarget(ctx, "/products");
  const headingSection = ctx.page.type === "HOME" ? "hero" : ctx.page.type === "ABOUT" ? "richText" : null;

  return (
    <div className={s.root} dir={store.direction} lang={store.direction === "rtl" ? "fa" : "en"} style={themeStyleVars(store)} data-template="bazaar" data-bazaar-layout="market">
      <a className={s.skip} href="#main">پرش به محتوا</a>
      <header className={s.header}>
        <div className={`${s.wrap} ${s.masthead}`} data-bazaar-region="masthead">
          <a className={s.brand} href={ctx.href("/")}>
            {logo && store.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} width={store.logo.width} height={store.logo.height} alt="" />
            ) : <span className={s.brandIcon}><Icon name="bag" /></span>}
            <span>{store.name}</span>
          </a>
          <form className={s.search} role="search" action={search.action} method="get">
            {search.hidden.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
            <input name="q" type="search" aria-label="جستجو در محصولات" placeholder="نام کالا، دسته یا مشخصات" maxLength={SEARCH_MAX} defaultValue={ctx.query.q} />
            <button aria-label="جستجو"><Icon name="search" /></button>
          </form>
          <div className={s.tools}>
            {pages.some((page) => page.type === "CONTACT") && (
              <a className={s.help} href={ctx.href("/contact")}><Icon name="headset" size={19} /> پشتیبانی</a>
            )}
            <ShopNav ctx={ctx} />
          </div>
        </div>
        <nav className={s.navigation} aria-label="ناوبری فروشگاه">
          <ul className={`${s.wrap} ${s.navItems}`} data-bazaar-region="category-navigation">
            {pages.filter((page) => page.type === "PRODUCTS").map((page) => (
              <li key={page.type}><a className={s.catalogLink} href={ctx.href(page.path)} aria-current={page.current ? "page" : undefined}><Icon name="grid" size={17} /> {page.title}</a></li>
            ))}
            {categories.map((category) => (
              <li key={category.id}><a href={listUrl(ctx, { category: category.slug })} aria-current={ctx.query.category === category.slug ? "true" : undefined}>{category.name}</a></li>
            ))}
            {pages.filter((page) => page.type !== "PRODUCTS").map((page) => (
              <li key={page.type}><a href={ctx.href(page.path)} aria-current={page.current ? "page" : undefined}>{page.title}</a></li>
            ))}
          </ul>
        </nav>
      </header>
      <main className={`${s.wrap} ${s.main}`} id="main" tabIndex={-1}>
        {headingSection && !ctx.page.sections.some((section) => section.type === headingSection) && <h1>{ctx.page.title}</h1>}
        {children}
      </main>
      <footer className={s.footer} data-bazaar-region="department-footer">
        <div className={`${s.wrap} ${s.footerGrid}`}>
          <div><p className={s.footerBrand}>{store.name}</p>{store.description && <p>{store.description}</p>}</div>
          <nav aria-label="پیوندهای پاورقی">
            <p className={s.footerLabel}>فروشگاه</p>
            <ul>{pages.map((page) => <li key={page.type}><a href={ctx.href(page.path)}>{page.title}</a></li>)}</ul>
          </nav>
          {categories.length > 0 && <nav aria-label="دسته‌های پاورقی">
            <p className={s.footerLabel}>دسته‌بندی‌ها</p>
            <ul>{categories.slice(0, 8).map((category) => <li key={category.id}><a href={listUrl(ctx, { category: category.slug })}>{category.name}</a></li>)}</ul>
          </nav>}
          {contacts.length > 0 && <address><p className={s.footerLabel}>راه‌های ارتباطی</p>
            <ul>{contacts.map((contact) => <li key={contact.kind}>{contact.href ? <a href={contact.href}>{contact.label} <bdi>{contact.value}</bdi></a> : contact.value}</li>)}</ul>
          </address>}
        </div>
        <div className={s.wrap}><EnamadSeal enamad={store.enamad} /></div>
      </footer>
    </div>
  );
}
