import { storyImage } from "./story-image";
import type { ReactNode } from "react";
import { formatNumberFa } from "@store-builder/shared/lib/money";
import { detailSpecs } from "@store-builder/shared/lib/product-specs";
import type { ProductSort } from "@store-builder/shared/templates/context-types";
import { buildContactLinks, type ContactLink } from "@store-builder/shared/templates/engine/links";
import { parseLabelLines, parseTable } from "@store-builder/shared/templates/engine/lines";
import { categoryOf, featuredProducts, formTarget, listProducts, listUrl, productsInCategory, relatedProducts, sectionImage } from "@store-builder/shared/templates/engine/listing";
import { SEARCH_MAX } from "@store-builder/shared/templates/engine/route";
import type { StorefrontCategory, StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import type { ThemeDefinition } from "@store-builder/shared/templates/theme";
import { KIT_THEMES_V2 } from "@store-builder/shared/templates/kit/themes";
import { CardSpecs, ProductSpecs } from "../engine/Specs";
import { navItems, themeStyleVars } from "../engine/theme-vars";
import type { ExtraSectionComponent, LayoutProps, RenderContext, SectionComponent, TemplateModule } from "../types";
import base from "./base.module.css";
import refresh from "./refresh.module.css";
import { CONTACT_ICON, highlightIcon, Icon, type IconName } from "./icons";

/**
 * The storefront kit, v2 (2026-11): one accessible implementation of every core section and of the kit sections, styled by
 * TWO CSS modules: `base.module.css` (structure, spacing, focus, responsive rules, driven by CSS variables) and the theme's
 * own module (tokens and the visual signature). Everything is derived from the storefront data contract (no discounts,
 * ratings or cart exist yet, so none are invented). No client JavaScript: search and sort are plain GET links and forms,
 * the category menu is a <details> element. No data access, no dashboard dependency; every text is escaped React text.
 */

type Styles = Readonly<Record<string, string>>;
type ExtraKind = "lines" | "steps" | "notice" | "sizeGuide";

export interface KitOptions {
  /**
   * Product cards: whether to show the category and an optional call to action (the store has no cart yet: the CTA links).
   * Every theme shows up to two specification rows on cards (product rule of phase 9C, pinned by specs.render.test.tsx).
   */
  card: { category: boolean; cta: null | { kind: "details"; label: string } | { kind: "whatsapp"; label: string } };
  /** A categories menu in the header (marketplace-style stores). */
  headerCategories: boolean;
  /** Featured products and category rows as a horizontal rail (default) or as a grid. */
  featured?: "rail" | "grid";
  /** Two category tiles beside the hero banner (marketplace-style home pages). */
  heroAside?: boolean;
  /** Renderers of the theme's own extra section types (beyond categories, promos, category rows and highlights). */
  extras?: Readonly<Record<string, ExtraKind>>;
}

export const initial = (name: string) => Array.from(name.trim())[0] ?? "؟";
const external = (href: string) => (href.startsWith("http") ? { rel: "noopener noreferrer", target: "_blank" } : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const fa = (n: number) => formatNumberFa(n);

const SORTS: { key: ProductSort | undefined; label: string }[] = [
  { key: undefined, label: "پیشنهاد فروشگاه" },
  { key: "cheap", label: "ارزان‌ترین" },
  { key: "expensive", label: "گران‌ترین" },
  { key: "available", label: "موجودها اول" },
];

const NAV_ICON: Record<string, IconName> = { HOME: "home", PRODUCTS: "grid", ABOUT: "info", CONTACT: "chat" };

/** Page numbers to show: first, last, and a window around the current page; null marks a gap. */
export function pageWindow(page: number, total: number): (number | null)[] {
  const keep = new Set([1, total, page - 1, page, page + 1].filter((n) => n >= 1 && n <= total));
  const sorted = [...keep].sort((a, b) => a - b);
  return sorted.flatMap((n, i) => (i > 0 && n - sorted[i - 1]! > 1 ? [null, n] : [n]));
}

export function createKitVariants(definition: ThemeDefinition, theme: Styles, opts: KitOptions): [TemplateModule, TemplateModule] {
  const next = KIT_THEMES_V2.find((item) => item.key === definition.key);
  if (!next) throw new Error(`Missing refreshed theme: ${definition.key}`);
  return [createKitTemplate(definition, theme, opts), createKitTemplate(next, theme, opts)];
}

function createKitTemplate(definition: ThemeDefinition, theme: Styles, opts: KitOptions): TemplateModule {
  const isRefresh = definition.version === 2;
  const s = new Proxy({} as Record<string, string>, { get: (_t, k: string) => [base[k], theme[k], isRefresh ? refresh[k] : undefined].filter(Boolean).join(" ") });
  const key = definition.key;
  const asRail = (opts.featured ?? "rail") === "rail";

  // ---- data helpers (pure, from the render context) ----

  /** The image of the first product of a category that has one (category tiles, promos, hero aside). */
  function categoryArt(ctx: RenderContext, categoryId: string | undefined) {
    const p = ctx.data.products.find((x) => (categoryId ? x.categoryId === categoryId : true) && x.image);
    const url = p?.image ? ctx.mediaUrl(p.image.key) : null;
    return p?.image && url ? { url, width: p.image.width, height: p.image.height } : null;
  }
  const countIn = (ctx: RenderContext, id: string) => ctx.data.products.filter((p) => p.categoryId === id).length;

  /** The store's own points ("title: text") from the home page's highlights section: the footer strip and the buy box. */
  function storePoints(ctx: RenderContext) {
    const home = ctx.data.pages.find((p) => p.type === "HOME");
    const sec = home?.sections.find((x) => x.type === `${key}.highlights`);
    return sec ? parseLabelLines(str((sec.props as Record<string, unknown>).items)).slice(0, 6) : [];
  }

  function whatsappOrder(ctx: RenderContext, product: StorefrontProduct): string | null {
    const wa = buildContactLinks(ctx.data.store.contact, ctx.data.store.social).find((l) => l.kind === "whatsapp");
    return wa?.href ? `${wa.href}?text=${encodeURIComponent(`سلام، برای سفارش «${product.name}» پیام می‌دهم.`)}` : null;
  }

  // ---- small components ----

  function Placeholder({ text, className }: { text: string; className?: string }) {
    return (
      <span className={`${s.placeholder} ${className ?? ""}`} aria-hidden="true">
        {initial(text)}
      </span>
    );
  }

  function Img({ img, eager = false }: { img: { url: string; width: number; height: number }; eager?: boolean }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={s.img} src={img.url} alt="" width={img.width} height={img.height} loading={eager ? "eager" : "lazy"} decoding="async" />;
  }

  function ProductArt({ product, ctx, eager = false }: { product: StorefrontProduct; ctx: RenderContext; eager?: boolean }) {
    const url = product.image ? ctx.mediaUrl(product.image.key) : null;
    if (!product.image || !url) return <Placeholder text={product.name} />;
    return (
      // Decorative in cards (the product name is the adjacent link text); descriptive on the detail page.
      // eslint-disable-next-line @next/next/no-img-element
      <img className={s.img} src={url} alt={eager ? product.name : ""} width={product.image.width} height={product.image.height} loading={eager ? "eager" : "lazy"} decoding="async" {...(eager ? { fetchPriority: "high" as const } : {})} />
    );
  }

  function Stock({ stock }: { stock: number }) {
    if (stock <= 0) return <span className={`${s.stock} ${s.stockOut}`}>ناموجود</span>;
    if (stock <= 5) return <span className={`${s.stock} ${s.stockLow}`}>تنها {fa(stock)} عدد باقی مانده</span>;
    return <span className={s.stock}>موجود</span>;
  }

  /** "۱۲۵٬۰۰۰ تومان" with the unit set smaller (the text content is exactly what formatToman returns). */
  function Price({ amount, className }: { amount: number; className?: string }) {
    return (
      <p className={className}>
        <span className={s.priceNum}>{amount.toLocaleString("fa-IR")}</span> <span className={s.priceUnit}>تومان</span>
      </p>
    );
  }

  function ProductCard({ product, ctx, category }: { product: StorefrontProduct; ctx: RenderContext; category: StorefrontCategory | null }) {
    const href = ctx.href(`/products/${encodeURIComponent(product.slug)}`);
    const cta = opts.card.cta;
    const ctaHref = cta?.kind === "whatsapp" ? whatsappOrder(ctx, product) : cta ? href : null;
    const out = product.stockQuantity <= 0;
    return (
      <li className={s.cardItem}>
        <article className={`${s.card} ${out ? s.cardOut : ""}`}>
          <div className={s.cardArt}>
            <ProductArt product={product} ctx={ctx} />
            {/* Visual badge only: the stock line below says the same in text. */}
            {out && (
              <span className={s.badge} aria-hidden="true">
                ناموجود
              </span>
            )}
          </div>
          <div className={s.cardBody}>
            {opts.card.category && category && <span className={s.cardCategory}>{category.name}</span>}
            <h3 className={s.cardHeading}>
              <a className={s.cardName} href={href}>
                {product.name}
              </a>
            </h3>
            <CardSpecs specs={product.specs} classes={{ list: s.cardSpecs, row: s.cardSpecRow, term: s.cardSpecTerm, def: s.cardSpecDef }} />
            <div className={s.cardFoot}>
              <Stock stock={product.stockQuantity} />
              <Price amount={product.price} className={s.price} />
            </div>
            {cta && ctaHref && (
              <a className={s.cardCta} href={ctaHref} {...external(ctaHref)} aria-label={`${cta.label}: ${product.name}`}>
                {cta.label}
              </a>
            )}
          </div>
        </article>
      </li>
    );
  }

  function Section({ title, children, alt, id, level = 2, className, action }: { title?: string; children: ReactNode; alt?: boolean; id: string; level?: 1 | 2; className?: string; action?: { href: string; label: string; aria?: string } }) {
    const H = `h${level}` as "h1" | "h2";
    return (
      <section className={`${s.section} ${alt ? s.sectionAlt : ""} ${className ?? ""}`} aria-labelledby={title ? `${id}-title` : undefined}>
        <div className={s.container}>
          {(title || action) && (
            <div className={s.sectionHead}>
              {title && (
                <H id={`${id}-title`} className={s.sectionTitle}>
                  {title}
                </H>
              )}
              {action && (
                <a className={s.seeAll} href={action.href} aria-label={action.aria}>
                  {action.label}
                  <Icon name="chevron" className={s.chev} size={18} />
                </a>
              )}
            </div>
          )}
          {children}
        </div>
      </section>
    );
  }

  const Empty = ({ title, text, children }: { title: string; text: string; children?: ReactNode }) => (
    <div className={s.empty} role="status">
      <Icon name="bag" className={s.emptyIcon} size={36} />
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );

  function ProductList({ ctx, items }: { ctx: RenderContext; items: StorefrontProduct[] }) {
    return (
      <ul className={s.grid}>
        {items.map((p) => (
          <ProductCard key={p.id} product={p} ctx={ctx} category={categoryOf(ctx, p.categoryId)} />
        ))}
      </ul>
    );
  }

  /** A horizontal, keyboard-scrollable rail (scroll snap; the region is focusable so it can be scrolled without a mouse). */
  function Rail({ ctx, items, label }: { ctx: RenderContext; items: StorefrontProduct[]; label: string }) {
    if (!asRail) return <ProductList ctx={ctx} items={items} />;
    return (
      <div className={s.rail} role="region" aria-label={label} tabIndex={0}>
        <ul className={s.railList}>
          {items.map((p) => (
            <ProductCard key={p.id} product={p} ctx={ctx} category={categoryOf(ctx, p.categoryId)} />
          ))}
        </ul>
      </div>
    );
  }

  // ---- layout: header (top bar, search, category menu, nav), mobile dock, footer ----

  function ContactIconLink({ l, className }: { l: ContactLink; className?: string }) {
    if (!l.href) return null;
    return (
      <a className={className} href={l.href} {...external(l.href)} aria-label={`${l.label}: ${l.value}`}>
        <Icon name={CONTACT_ICON[l.kind]} size={18} />
      </a>
    );
  }

  function Layout({ ctx, children }: LayoutProps) {
    const { store, categories } = ctx.data;
    const links = buildContactLinks(store.contact, store.social);
    const phone = links.find((l) => l.kind === "phone");
    const wa = links.find((l) => l.kind === "whatsapp");
    const socials = links.filter((l) => l.kind === "instagram" || l.kind === "telegram" || l.kind === "whatsapp");
    const logoUrl = store.logo ? ctx.mediaUrl(store.logo.key) : null;
    const nav = navItems(ctx);
    const showCats = opts.headerCategories && categories.length > 0;
    const search = formTarget(ctx, "/products");
    const points = ctx.page.sections.some((x) => x.type === `${key}.highlights`) ? [] : storePoints(ctx);
    const pageLinks = nav.filter((n) => n.type !== "HOME");
    const brand = (
      <a className={s.brand} href={ctx.href("/")}>
        {logoUrl && store.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={s.logo} src={logoUrl} alt="" width={store.logo.width} height={store.logo.height} decoding="async" />
        ) : (
          <span className={s.brandMark} aria-hidden="true">
            {initial(store.name)}
          </span>
        )}
        <span className={s.brandName}>{store.name}</span>
      </a>
    );
    return (
      <div className={s.root} dir={store.direction} lang={store.direction === "rtl" ? "fa" : "en"} style={themeStyleVars(store)} data-template={key} data-page={ctx.page.type}>
        <a className={s.skip} href="#main">
          رفتن به محتوا
        </a>
        <header className={s.header}>
          {(phone || socials.length > 0 || store.description) && (
            <div className={s.topBar}>
              <div className={`${s.container} ${s.topBarInner}`}>
                <p className={s.topBarText}>{store.description ?? `به ${store.name} خوش آمدید`}</p>
                <div className={s.topBarLinks}>
                  {phone?.href && (
                    <a className={s.topBarPhone} href={phone.href}>
                      <Icon name="phone" size={16} />
                      <span dir="ltr">{phone.value}</span>
                    </a>
                  )}
                  {socials.map((l) => (
                    <ContactIconLink key={l.kind} l={l} className={s.topBarIcon} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className={`${s.container} ${s.headerInner}`}>
            {brand}
            <form className={s.search} role="search" action={search.action} method="get">
              {search.hidden.map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <label className={s.srOnly} htmlFor="site-search">
                جستجو در محصولات
              </label>
              <input className={s.searchInput} id="site-search" type="search" name="q" defaultValue={ctx.query.q ?? ""} maxLength={SEARCH_MAX} placeholder={`جستجو در ${store.name}`} autoComplete="off" enterKeyHint="search" />
              <button className={s.searchBtn} type="submit" aria-label="جستجو">
                <Icon name="search" />
              </button>
            </form>
            <div className={s.headerActions}>
              {wa?.href && (
                <a className={s.actionBtn} href={wa.href} {...external(wa.href)}>
                  <Icon name="chat" />
                  <span className={s.actionLabel}>واتساپ</span>
                </a>
              )}
              {phone?.href && (
                <a className={`${s.actionBtn} ${s.actionPrimary}`} href={phone.href}>
                  <Icon name="phone" />
                  <span className={s.actionLabel}>تماس</span>
                </a>
              )}
            </div>
          </div>
          <div className={s.navRow}>
            <div className={`${s.container} ${s.navRowInner}`}>
              {showCats && (
                <details className={s.catMenu}>
                  <summary className={s.catMenuBtn}>
                    <Icon name="menu" />
                    دسته‌بندی کالاها
                  </summary>
                  <div className={s.catPanel}>
                    <ul className={s.catPanelList}>
                      {categories.slice(0, 24).map((c) => (
                        <li key={c.id}>
                          <a className={s.catPanelLink} href={listUrl(ctx, { category: c.slug })} aria-current={ctx.page.type === "PRODUCTS" && ctx.query.category === c.slug ? "true" : undefined}>
                            <span>{c.name}</span>
                            <span className={s.catCount}>{fa(countIn(ctx, c.id))}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                    <a className={s.catPanelAll} href={ctx.href("/products")}>
                      همه محصولات
                      <Icon name="chevron" className={s.chev} size={18} />
                    </a>
                  </div>
                </details>
              )}
              <nav className={s.nav} aria-label="منوی اصلی">
                <ul>
                  {nav.map((n) => (
                    <li key={n.type}>
                      <a className={s.navLink} href={ctx.href(n.path)} aria-current={n.current ? "page" : undefined}>
                        {n.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </div>
        </header>
        <main id="main" className={s.main} tabIndex={-1}>
          {children}
        </main>
        <footer className={s.footer}>
          {points.length > 0 && (
            <div className={s.trust}>
              <ul className={`${s.container} ${s.trustList}`} aria-label="خدمات فروشگاه">
                {points.map((p, i) => (
                  <li key={i} className={s.trustItem}>
                    <span className={s.trustIcon}>
                      <Icon name={highlightIcon(`${p.label} ${p.value}`)} size={22} />
                    </span>
                    <span>
                      {p.label && <span className={s.trustTitle}>{p.label}</span>}
                      <span className={s.trustText}>{p.value}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className={s.container}>
            <div className={s.footerGrid}>
              <div className={s.footerAbout}>
                <p className={s.footerName}>{store.name}</p>
                {store.description && <p className={s.footerText}>{store.description}</p>}
                {links.some((l) => l.kind === "phone" || l.kind === "email" || l.kind === "address") && (
                  <ul className={s.footerContact} aria-label="راه‌های ارتباطی">
                    {links
                      .filter((l) => l.kind === "phone" || l.kind === "email" || l.kind === "address")
                      .map((l) => (
                        <li key={l.kind}>
                          <Icon name={CONTACT_ICON[l.kind]} size={18} />
                          {l.href ? (
                            <a href={l.href} dir={l.kind === "address" ? undefined : "ltr"}>
                              {l.value}
                            </a>
                          ) : (
                            <span>{l.value}</span>
                          )}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
              {pageLinks.length > 0 && (
                <div>
                  <h2 className={s.footerHeading}>دسترسی سریع</h2>
                  <ul className={s.footerLinks}>
                    {pageLinks.map((n) => (
                      <li key={n.type}>
                        <a href={ctx.href(n.path)}>{n.title}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {categories.length > 0 && (
                <div>
                  <h2 className={s.footerHeading}>دسته‌بندی‌ها</h2>
                  <ul className={s.footerLinks}>
                    {categories.slice(0, 6).map((c) => (
                      <li key={c.id}>
                        <a href={listUrl(ctx, { category: c.slug })}>{c.name}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {socials.length > 0 && (
                <div>
                  <h2 className={s.footerHeading}>همراه ما باشید</h2>
                  <ul className={s.socials}>
                    {socials.map((l) => (
                      <li key={l.kind}>
                        <ContactIconLink l={l} className={s.socialBtn} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <p className={s.copy}>© {store.name}. همه‌ی حقوق محفوظ است.</p>
          </div>
        </footer>
        {nav.length > 1 && (
          <nav className={s.dock} aria-label="پیمایش سریع">
            <ul>
              {nav.map((n) => (
                <li key={n.type}>
                  <a className={s.dockLink} href={ctx.href(n.path)} aria-current={n.current ? "page" : undefined}>
                    <Icon name={NAV_ICON[n.type] ?? "home"} size={22} />
                    <span>{n.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    );
  }

  // ---- core sections ----

  const Hero: SectionComponent<"hero"> = ({ section, ctx }) => {
    const { title, subtitle, buttonText, buttonLink } = section.props;
    const img = sectionImage(ctx, section.props.imageId)
      ?? (isRefresh ? categoryArt(ctx, undefined) : null);
    const aside = opts.heroAside ? ctx.data.categories.slice(0, 2) : [];
    return (
      <section className={s.hero} aria-labelledby={`${section.id}-title`}>
        <div className={`${s.container} ${aside.length > 0 ? s.heroWithAside : ""}`}>
          <div className={s.heroInner} data-art={isRefresh && img ? "image" : undefined}>
            <span className={s.heroDeco} aria-hidden="true" />
            <div className={s.heroText}>
              <h1 id={`${section.id}-title`} className={s.heroTitle}>
                {title}
              </h1>
              {subtitle && <p className={s.heroSub}>{subtitle}</p>}
              {buttonText && (
                <div className={s.heroActions}>
                  <a className={s.btn} href={ctx.href(buttonLink)}>
                    {buttonText}
                    <Icon name="chevron" className={s.chev} size={18} />
                  </a>
                </div>
              )}
            </div>
            <div className={s.heroArt}>
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={s.img} src={img.url} alt="" width={img.width} height={img.height} decoding="async" fetchPriority="high" />
              ) : (
                <Placeholder text={ctx.data.store.name} className={s.heroPlaceholder} />
              )}
            </div>
          </div>
          {aside.length > 0 && (
            <ul className={s.heroAside} aria-label="دسته‌های منتخب">
              {aside.map((c) => {
                const art = categoryArt(ctx, c.id);
                return (
                  <li key={c.id}>
                    <a className={s.asideTile} href={listUrl(ctx, { category: c.slug })}>
                      <span className={s.asideText}>
                        <span className={s.asideName}>{c.name}</span>
                        <span className={s.asideMore}>
                          {fa(countIn(ctx, c.id))} کالا
                          <Icon name="chevron" className={s.chev} size={16} />
                        </span>
                      </span>
                      <span className={s.asideArt}>{art ? <Img img={art} /> : <Placeholder text={c.name} />}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    );
  };

  const FeaturedProducts: SectionComponent<"featuredProducts"> = ({ section, ctx }) => {
    const items = featuredProducts(ctx, section.props.limit);
    const more = ctx.data.products.length > items.length || asRail;
    return (
      <Section id={section.id} title={section.props.title} className={s.featured} action={items.length > 0 && more ? { href: ctx.href("/products"), label: "مشاهده همه", aria: "مشاهده همه محصولات" } : undefined}>
        {items.length === 0 ? <Empty title="هنوز محصولی منتشر نشده است" text="به‌زودی محصولات این فروشگاه اینجا نمایش داده می‌شود." /> : <Rail ctx={ctx} items={items} label={section.props.title} />}
      </Section>
    );
  };

  const CategoryFilter: SectionComponent<"categoryFilter"> = ({ section, ctx }) => {
    const { categories } = ctx.data;
    if (categories.length === 0) return null;
    const { category: active, q, sort } = ctx.query;
    return (
      <div className={`${s.container} ${s.filter}`}>
        <nav aria-label="دسته‌بندی محصولات" id={section.id}>
          <ul className={s.chips}>
            <li>
              <a className={s.chip} href={listUrl(ctx, { q, sort })} aria-current={!active ? "true" : undefined}>
                همه
                <span className={s.chipCount}>{fa(ctx.data.products.length)}</span>
              </a>
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <a className={s.chip} href={listUrl(ctx, { category: c.slug, q, sort })} aria-current={active === c.slug ? "true" : undefined}>
                  {c.name}
                  <span className={s.chipCount}>{fa(countIn(ctx, c.id))}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    );
  };

  const ProductGrid: SectionComponent<"productGrid"> = ({ section, ctx }) => {
    const list = listProducts(ctx);
    const cat = list.category?.slug;
    const title = list.q ? `جستجو: «${list.q}»` : list.category ? list.category.name : section.props.title;
    const pageUrl = (page: number) => listUrl(ctx, { category: cat, q: list.q, sort: list.sort, page });
    return (
      <Section id={section.id} title={title} level={ctx.page.type === "PRODUCTS" ? 1 : 2} className={s.listing}>
        <div className={s.toolbar}>
          <nav className={s.sorts} aria-label="مرتب‌سازی">
            <span className={s.sortsLabel}>
              <Icon name="sort" size={18} />
              مرتب‌سازی:
            </span>
            <ul>
              {SORTS.map((o) => (
                <li key={o.label}>
                  <a className={s.sortLink} href={listUrl(ctx, { category: cat, q: list.q, sort: o.key })} aria-current={list.sort === o.key ? "true" : undefined}>
                    {o.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <p className={s.resultCount}>{fa(list.total)} کالا</p>
        </div>
        {list.q && (
          <p className={s.searchNote}>
            نتیجه‌ی جستجو برای «{list.q}»
            {list.category ? ` در ${list.category.name}` : ""}.{" "}
            <a href={listUrl(ctx, { category: cat, sort: list.sort })}>پاک کردن جستجو</a>
          </p>
        )}
        {list.items.length === 0 ? (
          list.q ? (
            <Empty title={`نتیجه‌ای برای «${list.q}» پیدا نشد`} text="املای عبارت را بررسی کنید یا عبارت کوتاه‌تری را امتحان کنید.">
              <a className={`${s.btn} ${s.btnGhost}`} href={ctx.href("/products")}>
                همه محصولات
              </a>
            </Empty>
          ) : list.category ? (
            <Empty title="در این دسته محصولی وجود ندارد" text="دسته‌بندی دیگری را انتخاب کنید یا همه محصولات را ببینید." />
          ) : (
            <Empty title="هنوز محصولی منتشر نشده است" text="به‌زودی محصولات این فروشگاه اینجا نمایش داده می‌شود." />
          )
        ) : (
          <>
            <ProductList ctx={ctx} items={list.items} />
            {list.totalPages > 1 && (
              <nav className={s.pager} aria-label="صفحه‌بندی محصولات">
                {list.page > 1 && (
                  <a className={s.pageArrow} rel="prev" href={pageUrl(list.page - 1)}>
                    <Icon name="chevron" className={s.chevBack} size={18} />
                    صفحه قبل
                  </a>
                )}
                <ul className={s.pages}>
                  {pageWindow(list.page, list.totalPages).map((n, i) =>
                    n === null ? (
                      <li key={`gap-${i}`} className={s.pageGap} aria-hidden="true">
                        …
                      </li>
                    ) : (
                      <li key={n}>
                        <a className={s.pageLink} href={pageUrl(n)} aria-current={n === list.page ? "page" : undefined} aria-label={`صفحه ${fa(n)}`}>
                          {fa(n)}
                        </a>
                      </li>
                    ),
                  )}
                </ul>
                <span className={s.srOnly}>
                  صفحه {fa(list.page)} از {fa(list.totalPages)}
                </span>
                {list.page < list.totalPages && (
                  <a className={s.pageArrow} rel="next" href={pageUrl(list.page + 1)}>
                    صفحه بعد
                    <Icon name="chevron" className={s.chev} size={18} />
                  </a>
                )}
              </nav>
            )}
          </>
        )}
      </Section>
    );
  };

  const ProductDetail: SectionComponent<"productDetail"> = ({ section, ctx }) => {
    const p = ctx.product;
    if (!p) return null;
    const category = categoryOf(ctx, p.categoryId);
    const order = buildContactLinks(ctx.data.store.contact, ctx.data.store.social).filter((l) => l.kind === "whatsapp" || l.kind === "phone");
    const wa = whatsappOrder(ctx, p);
    const orderHref = (l: ContactLink) => (l.kind === "whatsapp" && wa ? wa : l.href!);
    const orderLabel = (l: ContactLink) => (l.kind === "whatsapp" ? "سفارش در واتساپ" : "تماس برای سفارش");
    const keySpecs = detailSpecs(p.specs).slice(0, 4);
    const points = storePoints(ctx).slice(0, 3);
    const related = relatedProducts(ctx, p, 10);
    const out = p.stockQuantity <= 0;
    return (
      <>
        <section className={`${s.section} ${s.detailSection}`} aria-labelledby={`${section.id}-title`}>
          <div className={s.container}>
            <nav className={s.crumbs} aria-label="مسیر">
              <ol>
                <li>
                  <a href={ctx.href("/")}>خانه</a>
                </li>
                <li>
                  <a href={ctx.href("/products")}>محصولات</a>
                </li>
                {category && (
                  <li>
                    <a href={listUrl(ctx, { category: category.slug })}>{category.name}</a>
                  </li>
                )}
                <li aria-current="page">{p.name}</li>
              </ol>
            </nav>
            <div className={s.detail}>
              <div className={s.detailArt}>
                <ProductArt product={p} ctx={ctx} eager />
                {out && (
                  <span className={s.badge} aria-hidden="true">
                    ناموجود
                  </span>
                )}
              </div>
              <div className={s.detailInfo}>
                {category && (
                  <a className={s.detailCategory} href={listUrl(ctx, { category: category.slug })}>
                    {category.name}
                  </a>
                )}
                <h1 id={`${section.id}-title`} className={s.detailTitle}>
                  {p.name}
                </h1>
                {keySpecs.length > 0 && (
                  <div className={s.keySpecs}>
                    <h2 className={s.keySpecsTitle}>ویژگی‌های کلیدی</h2>
                    <ul>
                      {keySpecs.map((r, i) => (
                        <li key={i}>
                          <span className={s.keySpecLabel}>{r.label}:</span> {r.value}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.description ? <p className={`${s.prose} ${s.detailText}`}>{p.description}</p> : null}
              </div>
              <aside className={s.buyBox} aria-label="سفارش">
                <Price amount={p.price} className={s.detailPrice} />
                <Stock stock={p.stockQuantity} />
                {order.length > 0 && (
                  <div className={s.actions}>
                    {order.map((l) => {
                      const href = orderHref(l);
                      return (
                        <a key={l.kind} className={l.kind === "whatsapp" ? s.btn : `${s.btn} ${s.btnGhost}`} href={href} {...external(href)}>
                          <Icon name={l.kind === "whatsapp" ? "chat" : "phone"} />
                          {orderLabel(l)}
                        </a>
                      );
                    })}
                  </div>
                )}
                {points.length > 0 && (
                  <ul className={s.assure} aria-label="خدمات فروشگاه">
                    {points.map((pt, i) => (
                      <li key={i}>
                        <Icon name={highlightIcon(`${pt.label} ${pt.value}`)} size={18} />
                        <span>{pt.label ? `${pt.label}: ${pt.value}` : pt.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className={s.note}>برای سفارش با فروشگاه تماس بگیرید. خرید آنلاین در این نسخه فعال نیست.</p>
              </aside>
            </div>
            <ProductSpecs specs={p.specs} classes={{ wrap: s.specs, title: s.specsTitle, list: s.specsList, row: s.specsRow, term: s.specsTerm, def: s.specsDef }} />
          </div>
          {order.length > 0 && (
            // Phone-width sticky order bar (the same first route as the buy box); hidden on wider screens.
            <div className={s.buyBar}>
              <Price amount={p.price} className={s.buyBarPrice} />
              <a className={s.btn} href={orderHref(order[order.length - 1]!)} {...external(orderHref(order[order.length - 1]!))}>
                {orderLabel(order[order.length - 1]!)}
              </a>
            </div>
          )}
        </section>
        {related.length > 0 && (
          <Section id={`${section.id}-related`} title={category ? `دیگر محصولات ${category.name}` : "محصولات دیگر"} className={s.related} action={category ? { href: listUrl(ctx, { category: category.slug }), label: "مشاهده همه", aria: `مشاهده همه محصولات ${category.name}` } : undefined}>
            <Rail ctx={ctx} items={related} label="محصولات مرتبط" />
          </Section>
        )}
      </>
    );
  };

  const RichText: SectionComponent<"richText"> = ({ section, ctx }) => (
    <Section id={section.id} title={section.props.title} level={ctx.page.type === "ABOUT" ? 1 : 2}>
      {section.props.body ? <p className={s.prose}>{section.props.body}</p> : null}
    </Section>
  );

  const ImageText: SectionComponent<"imageText"> = ({ section, ctx }) => {
    const img = storyImage({ ctx, section });
    return (
      <Section id={section.id} alt>
        <div className={s.split}>
          <div className={s.splitText}>
            <h2 id={`${section.id}-title`} className={s.sectionTitle}>
              {section.props.title}
            </h2>
            {section.props.body ? <p className={s.prose}>{section.props.body}</p> : null}
          </div>
          <div className={s.splitArt}>{img ? <Img img={img} /> : <Placeholder text={section.props.title} />}</div>
        </div>
      </Section>
    );
  };

  const ContactInfo: SectionComponent<"contactInfo"> = ({ section, ctx }) => {
    const links = buildContactLinks(ctx.data.store.contact, ctx.data.store.social);
    return (
      <Section id={section.id} title={section.props.title} level={ctx.page.type === "CONTACT" ? 1 : 2}>
        {section.props.body ? <p className={s.prose}>{section.props.body}</p> : null}
        {links.length === 0 ? (
          <div className={s.spaced}>
            <Empty title="اطلاعات تماس ثبت نشده است" text="فروشگاه هنوز راه ارتباطی اعلام نکرده است." />
          </div>
        ) : (
          <ul className={s.contactList}>
            {links.map((l) => (
              <li key={l.kind} className={s.contactItem}>
                <span className={s.contactIcon}>
                  <Icon name={CONTACT_ICON[l.kind]} />
                </span>
                <span className={s.contactBody}>
                  <span className={s.contactLabel}>{l.label}</span>
                  <span className={s.contactValue} dir={l.kind === "address" ? undefined : "ltr"}>
                    {l.href ? (
                      <a href={l.href} {...external(l.href)}>
                        {l.value}
                      </a>
                    ) : (
                      l.value
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    );
  };

  const CallToAction: SectionComponent<"callToAction"> = ({ section, ctx }) => (
    <section className={s.section} aria-labelledby={`${section.id}-title`}>
      <div className={s.container}>
        <div className={s.cta}>
          <span className={s.ctaDeco} aria-hidden="true" />
          <h2 id={`${section.id}-title`} className={s.ctaTitle}>
            {section.props.title}
          </h2>
          {section.props.buttonText && (
            <a className={s.btn} href={ctx.href(section.props.buttonLink)}>
              {section.props.buttonText}
              <Icon name="chevron" className={s.chev} size={18} />
            </a>
          )}
        </div>
      </div>
    </section>
  );

  // ---- kit sections (namespaced by the theme) ----

  /** The store's categories as tiles; each shows the image of the category's first product that has one. */
  const Categories: ExtraSectionComponent = ({ section, ctx }) => {
    const { categories } = ctx.data;
    if (categories.length === 0) return null;
    const title = str(section.props.title);
    return (
      <Section id={section.id} title={title || undefined} className={s.tilesSection}>
        <ul className={s.tiles} aria-label={title ? undefined : "دسته‌بندی‌ها"}>
          {categories.slice(0, 12).map((c) => {
            const art = categoryArt(ctx, c.id);
            return (
              <li key={c.id}>
                <a className={s.tile} href={listUrl(ctx, { category: c.slug })}>
                  <span className={s.tileArt}>{art ? <Img img={art} /> : <Placeholder text={c.name} />}</span>
                  <span className={s.tileName}>{c.name}</span>
                  <span className={s.tileCount}>{fa(countIn(ctx, c.id))} کالا</span>
                </a>
              </li>
            );
          })}
        </ul>
      </Section>
    );
  };

  /** 2–4 promotional tiles; each links to a store category named on its line (or to all products). */
  const Promos: ExtraSectionComponent = ({ section, ctx }) => {
    const rows = str(section.props.items)
      .split("\n")
      .map((line) => line.split("|").map((x) => x.trim()))
      .filter((cols) => cols[0])
      .slice(0, 4);
    if (rows.length === 0) return null;
    const title = str(section.props.title);
    return (
      <Section id={section.id} title={title || undefined} className={s.promosSection}>
        <ul className={s.promos} data-count={rows.length} aria-label={title ? undefined : "پیشنهادها"}>
          {rows.map(([name, sub, catName], i) => {
            const c = catName ? ctx.data.categories.find((x) => x.name === catName || x.slug === catName) : undefined;
            const art = categoryArt(ctx, c?.id);
            return (
              <li key={i}>
                <a className={s.promo} href={c ? listUrl(ctx, { category: c.slug }) : ctx.href("/products")} data-tone={i % 4}>
                  <span className={s.promoText}>
                    <span className={s.promoTitle}>{name}</span>
                    {sub && <span className={s.promoSub}>{sub}</span>}
                    <span className={s.promoCta}>
                      مشاهده
                      <Icon name="chevron" className={s.chev} size={16} />
                    </span>
                  </span>
                  <span className={s.promoArt} aria-hidden="true">
                    {art ? <Img img={art} /> : <span className={s.promoMark}>{initial(name ?? "")}</span>}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </Section>
    );
  };

  /** One rail per category that has products (in the store's order). */
  const CategoryRows: ExtraSectionComponent = ({ section, ctx }) => {
    const limit = Math.min(12, Math.max(4, num(section.props.limit, 8)));
    const rows = ctx.data.categories
      .map((c) => ({ c, items: productsInCategory(ctx, c.id, limit) }))
      .filter((r) => r.items.length > 0)
      .slice(0, Math.min(6, Math.max(1, num(section.props.categories, 3))));
    if (rows.length === 0) return null;
    return (
      <>
        {rows.map(({ c, items }) => (
          <Section key={c.id} id={`${section.id}-${c.id}`} title={c.name} className={s.categoryRow} action={{ href: listUrl(ctx, { category: c.slug }), label: "مشاهده همه", aria: `مشاهده همه محصولات ${c.name}` }}>
            <Rail ctx={ctx} items={items} label={c.name} />
          </Section>
        ))}
      </>
    );
  };

  const Highlights: ExtraSectionComponent = ({ section }) => {
    const items = parseLabelLines(str(section.props.items));
    if (items.length === 0) return null;
    const title = str(section.props.title);
    return (
      <Section id={section.id} title={title || undefined} className={s.highlightsSection}>
        <ul className={s.highlights} aria-label={title ? undefined : "ویژگی‌های فروشگاه"}>
          {items.map((it, i) => (
            <li key={i} className={s.highlight}>
              <span className={s.highlightIcon}>
                <Icon name={highlightIcon(`${it.label} ${it.value}`)} size={24} />
              </span>
              <span className={s.highlightBody}>
                {it.label && <span className={s.highlightTitle}>{it.label}</span>}
                <span className={s.highlightText}>{it.value}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>
    );
  };

  /** "label: value" rows with dotted leaders (a menu, opening hours). */
  const makeLines = (variant: string): ExtraSectionComponent =>
    function Lines({ section }) {
      const rows = parseLabelLines(str(section.props.items));
      const note = str(section.props.note);
      return (
        <Section id={section.id} title={str(section.props.title)} className={`${s.linesSection} ${s[variant] ?? ""}`}>
          {rows.length > 0 && (
            <dl className={s.lines}>
              {rows.map((r, i) => (
                <div key={i} className={s.line}>
                  {/* The dotted leader is a dt::after rule: a <dl> group may contain only dt and dd. */}
                  <dt className={s.lineLabel}>{r.label || r.value}</dt>
                  <dd className={s.lineValue}>{r.label ? r.value : ""}</dd>
                </div>
              ))}
            </dl>
          )}
          {note && <p className={s.linesNote}>{note}</p>}
        </Section>
      );
    };

  /** A real sequence (how a digital purchase is delivered): an ordered list. */
  const Steps: ExtraSectionComponent = ({ section }) => {
    const rows = parseLabelLines(str(section.props.items));
    const note = str(section.props.note);
    return (
      <Section id={section.id} title={str(section.props.title)} className={s.stepsSection}>
        <ol className={s.steps}>
          {rows.map((r, i) => (
            <li key={i} className={s.step}>
              <span className={s.stepNum} aria-hidden="true">
                {(i + 1).toLocaleString("fa-IR")}
              </span>
              <span className={s.stepTitle}>{r.label || r.value}</span>
              {r.label && <span className={s.stepText}>{r.value}</span>}
            </li>
          ))}
        </ol>
        {note && <p className={s.linesNote}>{note}</p>}
      </Section>
    );
  };

  const Notice: ExtraSectionComponent = ({ section }) => {
    const badge = str(section.props.badge);
    return (
      <section className={s.section} aria-labelledby={`${section.id}-title`}>
        <div className={s.container}>
          <div className={s.notice}>
            <span className={s.noticeIcon}>
              <Icon name={highlightIcon(`${str(section.props.title)} ${str(section.props.body)}`)} size={28} />
            </span>
            <div className={s.noticeBody}>
              <h2 id={`${section.id}-title`} className={s.noticeTitle}>
                {str(section.props.title)}
              </h2>
              {str(section.props.body) && <p className={s.noticeText}>{str(section.props.body)}</p>}
            </div>
            {badge && <span className={s.noticeBadge}>{badge}</span>}
          </div>
        </div>
      </section>
    );
  };

  const SizeGuide: ExtraSectionComponent = ({ section }) => {
    const table = parseTable(str(section.props.table));
    const note = str(section.props.note);
    return (
      <Section id={section.id} title={str(section.props.title)} alt>
        {str(section.props.intro) && <p className={s.prose}>{str(section.props.intro)}</p>}
        {table && (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  {table.head.map((h, i) => (
                    <th key={i} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) =>
                      j === 0 ? (
                        <th key={j} scope="row">
                          {cell}
                        </th>
                      ) : (
                        <td key={j}>{cell}</td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {note && <p className={s.linesNote}>{note}</p>}
      </Section>
    );
  };

  const renderers: Record<ExtraKind, (type: string) => ExtraSectionComponent> = {
    lines: (type) => makeLines(type.split(".")[1] ?? "lines"),
    steps: () => Steps,
    notice: () => Notice,
    sizeGuide: () => SizeGuide,
  };
  const extraSections: Record<string, ExtraSectionComponent> = {
    [`${key}.categories`]: Categories,
    [`${key}.promos`]: Promos,
    [`${key}.categoryRows`]: CategoryRows,
    [`${key}.highlights`]: Highlights,
  };
  for (const [type, kind] of Object.entries(opts.extras ?? {})) extraSections[type] = renderers[kind](type);

  return {
    definition,
    key,
    version: definition.version,
    name: definition.meta.name,
    Layout,
    editor: definition.editor,
    sections: { hero: Hero, featuredProducts: FeaturedProducts, productGrid: ProductGrid, categoryFilter: CategoryFilter, productDetail: ProductDetail, richText: RichText, imageText: ImageText, contactInfo: ContactInfo, callToAction: CallToAction },
    extraSections,
  };
}

