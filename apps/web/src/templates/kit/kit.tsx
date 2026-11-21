import type { ReactNode } from "react";
import { formatNumberFa, formatToman } from "@store-builder/shared/lib/money";
import { buildContactLinks } from "@store-builder/shared/templates/engine/links";
import { parseLabelLines, parseTable } from "@store-builder/shared/templates/engine/lines";
import { categoryOf, featuredProducts, listProducts, listUrl, sectionImage } from "@store-builder/shared/templates/engine/listing";
import type { StorefrontCategory, StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import type { ThemeDefinition } from "@store-builder/shared/templates/theme";
import { CardSpecs, ProductSpecs } from "../engine/Specs";
import { navItems, themeStyleVars } from "../engine/theme-vars";
import type { ExtraSectionComponent, LayoutProps, RenderContext, SectionComponent, TemplateModule } from "../types";
import base from "./base.module.css";

/**
 * The storefront kit (2026-11): one accessible implementation of every core section and of the kit sections
 * (`<key>.categories`, `<key>.highlights`, lines, steps, notice, size guide), styled by TWO CSS modules: `base.module.css`
 * (structure, spacing, focus, responsive rules, driven by CSS variables) and the theme's own module (tokens and the
 * visual signature). Markup and wording follow the MVP themes, so behaviour and tests stay theme-independent.
 * No data access, no dashboard dependency; every text is escaped React text.
 */

type Styles = Readonly<Record<string, string>>;
type ExtraKind = "lines" | "steps" | "notice" | "sizeGuide";

export interface KitOptions {
  /**
   * Product cards: whether to show the category and an optional call to action (the store has no cart yet: the CTA links).
   * Every theme shows up to two specification rows on cards (product rule of phase 9C, pinned by specs.render.test.tsx).
   */
  card: { category: boolean; cta: null | { kind: "details"; label: string } | { kind: "whatsapp"; label: string } };
  /** A row of the store's categories under the header (marketplace-style stores). */
  headerCategories: boolean;
  /** Renderers of the theme's own extra section types (beyond `categories` and `highlights`). */
  extras?: Readonly<Record<string, ExtraKind>>;
}

export const initial = (name: string) => Array.from(name.trim())[0] ?? "؟";
const external = (href: string) => (href.startsWith("http") ? { rel: "noopener noreferrer", target: "_blank" } : {});

export function createKitTemplate(definition: ThemeDefinition, theme: Styles, opts: KitOptions): TemplateModule {
  const s = new Proxy({} as Record<string, string>, { get: (_t, k: string) => [base[k], theme[k]].filter(Boolean).join(" ") });
  const key = definition.key;

  function Placeholder({ text, className }: { text: string; className?: string }) {
    return (
      <span className={`${s.placeholder} ${className ?? ""}`} aria-hidden="true">
        {initial(text)}
      </span>
    );
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
    if (stock <= 5) return <span className={`${s.stock} ${s.stockLow}`}>تنها {formatNumberFa(stock)} عدد باقی مانده</span>;
    return <span className={s.stock}>موجود</span>;
  }

  function whatsappOrder(ctx: RenderContext, product: StorefrontProduct): string | null {
    const wa = buildContactLinks(ctx.data.store.contact, ctx.data.store.social).find((l) => l.kind === "whatsapp");
    return wa?.href ? `${wa.href}?text=${encodeURIComponent(`سلام، برای سفارش «${product.name}» پیام می‌دهم.`)}` : null;
  }

  function ProductCard({ product, ctx, category }: { product: StorefrontProduct; ctx: RenderContext; category: StorefrontCategory | null }) {
    const href = ctx.href(`/products/${encodeURIComponent(product.slug)}`);
    const cta = opts.card.cta;
    const ctaHref = cta?.kind === "whatsapp" ? whatsappOrder(ctx, product) : cta ? href : null;
    return (
      <li>
        <article className={s.card}>
          <div className={s.cardArt}>
            <ProductArt product={product} ctx={ctx} />
          </div>
          <div className={s.cardBody}>
            {opts.card.category && category && <span className={s.cardCategory}>{category.name}</span>}
            <h3 className={s.cardHeading}>
              <a className={s.cardName} href={href}>
                {product.name}
              </a>
            </h3>
            <CardSpecs specs={product.specs} classes={{ list: s.cardSpecs, row: s.cardSpecRow, term: s.cardSpecTerm, def: s.cardSpecDef }} />
            <Stock stock={product.stockQuantity} />
            <p className={s.price}>{formatToman(product.price)}</p>
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

  function Section({ title, children, alt, id, level = 2, className }: { title?: string; children: ReactNode; alt?: boolean; id: string; level?: 1 | 2; className?: string }) {
    const H = `h${level}` as "h1" | "h2";
    return (
      <section className={`${s.section} ${alt ? s.sectionAlt : ""} ${className ?? ""}`} aria-labelledby={title ? `${id}-title` : undefined}>
        <div className={s.container}>
          {title && (
            <H id={`${id}-title`} className={s.sectionTitle}>
              {title}
            </H>
          )}
          {children}
        </div>
      </section>
    );
  }

  const Empty = ({ title, text }: { title: string; text: string }) => (
    <div className={s.empty} role="status">
      <h3>{title}</h3>
      <p>{text}</p>
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

  function Layout({ ctx, children }: LayoutProps) {
    const { store, categories } = ctx.data;
    const links = buildContactLinks(store.contact, store.social);
    const logoUrl = store.logo ? ctx.mediaUrl(store.logo.key) : null;
    const nav = navItems(ctx);
    const showCats = opts.headerCategories && categories.length > 0;
    return (
      <div className={s.root} dir={store.direction} lang={store.direction === "rtl" ? "fa" : "en"} style={themeStyleVars(store)} data-template={key}>
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
              <span className={s.brandName}>{store.name}</span>
            </a>
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
          {showCats && (
            <nav className={s.catBar} aria-label="دسته‌های فروشگاه">
              <ul className={s.container}>
                {categories.slice(0, 12).map((c) => (
                  <li key={c.id}>
                    <a className={s.catBarLink} href={listUrl(ctx, { category: c.slug })} aria-current={ctx.page.type === "PRODUCTS" && ctx.query.category === c.slug ? "true" : undefined}>
                      {c.name}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </header>
        <main id="main" className={s.main} tabIndex={-1}>
          {children}
        </main>
        <footer className={s.footer}>
          <div className={s.container}>
            <div className={s.footerGrid}>
              <div>
                <p className={s.footerName}>{store.name}</p>
                {store.description && <p className={s.footerText}>{store.description}</p>}
              </div>
              {nav.length > 0 && (
                <ul className={s.footerLinks} aria-label="صفحه‌ها">
                  {nav.map((n) => (
                    <li key={n.type}>
                      <a href={ctx.href(n.path)}>{n.title}</a>
                    </li>
                  ))}
                </ul>
              )}
              {links.length > 0 && (
                <ul className={s.footerLinks} aria-label="راه‌های ارتباطی">
                  {links.map((l) => (
                    <li key={l.kind}>
                      {l.href ? (
                        <a href={l.href} {...external(l.href)}>
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
        </footer>
      </div>
    );
  }

  const Hero: SectionComponent<"hero"> = ({ section, ctx }) => {
    const { title, subtitle, buttonText, buttonLink } = section.props;
    const img = sectionImage(ctx, section.props.imageId);
    return (
      <section className={s.hero} aria-labelledby={`${section.id}-title`}>
        <div className={`${s.container} ${s.heroInner}`}>
          <div className={s.heroText}>
            <h1 id={`${section.id}-title`} className={s.heroTitle}>
              {title}
            </h1>
            {subtitle && <p className={s.heroSub}>{subtitle}</p>}
            {buttonText && (
              <div className={s.heroActions}>
                <a className={s.btn} href={ctx.href(buttonLink)}>
                  {buttonText}
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
      </section>
    );
  };

  const FeaturedProducts: SectionComponent<"featuredProducts"> = ({ section, ctx }) => {
    const items = featuredProducts(ctx, section.props.limit);
    return (
      <Section id={section.id} title={section.props.title}>
        {items.length === 0 ? (
          <Empty title="هنوز محصولی منتشر نشده است" text="به‌زودی محصولات این فروشگاه اینجا نمایش داده می‌شود." />
        ) : (
          <>
            <ProductList ctx={ctx} items={items} />
            {ctx.data.products.length > items.length && (
              <p className={s.more}>
                <a className={`${s.btn} ${s.btnGhost}`} href={ctx.href("/products")}>
                  مشاهده همه محصولات
                </a>
              </p>
            )}
          </>
        )}
      </Section>
    );
  };

  const CategoryFilter: SectionComponent<"categoryFilter"> = ({ section, ctx }) => {
    const { categories } = ctx.data;
    if (categories.length === 0) return null;
    const active = ctx.query.category;
    return (
      <div className={`${s.container} ${s.filter}`}>
        <nav aria-label="دسته‌بندی محصولات" id={section.id}>
          <ul className={s.chips}>
            <li>
              <a className={s.chip} href={listUrl(ctx, {})} aria-current={!active ? "true" : undefined}>
                همه
              </a>
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <a className={s.chip} href={listUrl(ctx, { category: c.slug })} aria-current={active === c.slug ? "true" : undefined}>
                  {c.name}
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
    return (
      <Section id={section.id} title={list.category ? list.category.name : section.props.title} level={ctx.page.type === "PRODUCTS" ? 1 : 2}>
        {list.items.length === 0 ? (
          list.category ? (
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
                  <a className={`${s.btn} ${s.btnGhost}`} rel="prev" href={listUrl(ctx, { category: list.category?.slug, page: list.page - 1 })}>
                    صفحه قبل
                  </a>
                )}
                <span className={s.pagerInfo}>
                  صفحه {list.page.toLocaleString("fa-IR")} از {list.totalPages.toLocaleString("fa-IR")}
                </span>
                {list.page < list.totalPages && (
                  <a className={`${s.btn} ${s.btnGhost}`} rel="next" href={listUrl(ctx, { category: list.category?.slug, page: list.page + 1 })}>
                    صفحه بعد
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
    return (
      <section className={s.section} aria-labelledby={`${section.id}-title`}>
        <div className={s.container}>
          <nav className={s.crumbs} aria-label="مسیر">
            <a href={ctx.href("/")}>خانه</a> / <a href={ctx.href("/products")}>محصولات</a>
            {category && (
              <>
                {" "}
                / <a href={listUrl(ctx, { category: category.slug })}>{category.name}</a>
              </>
            )}
          </nav>
          <div className={s.detail}>
            <div className={s.detailArt}>
              <ProductArt product={p} ctx={ctx} eager />
            </div>
            <div className={s.detailInfo}>
              {category && <span className={s.cardCategory}>{category.name}</span>}
              <h1 id={`${section.id}-title`} className={s.detailTitle}>
                {p.name}
              </h1>
              <p className={s.detailPrice}>{formatToman(p.price)}</p>
              <Stock stock={p.stockQuantity} />
              {p.description ? <p className={`${s.prose} ${s.detailText}`}>{p.description}</p> : null}
              {order.length > 0 && (
                <div className={s.actions}>
                  {order.map((l) => {
                    const href = l.kind === "whatsapp" && wa ? wa : l.href!;
                    return (
                      <a key={l.kind} className={l.kind === "whatsapp" ? s.btn : `${s.btn} ${s.btnGhost}`} href={href} {...external(href)}>
                        {l.kind === "whatsapp" ? "سفارش در واتساپ" : "تماس برای سفارش"}
                      </a>
                    );
                  })}
                </div>
              )}
              <p className={s.note}>برای سفارش با فروشگاه تماس بگیرید. خرید آنلاین در این نسخه فعال نیست.</p>
            </div>
          </div>
          <ProductSpecs specs={p.specs} classes={{ wrap: s.specs, title: s.specsTitle, list: s.specsList, row: s.specsRow, term: s.specsTerm, def: s.specsDef }} />
        </div>
      </section>
    );
  };

  const RichText: SectionComponent<"richText"> = ({ section, ctx }) => (
    <Section id={section.id} title={section.props.title} level={ctx.page.type === "ABOUT" ? 1 : 2}>
      {section.props.body ? <p className={s.prose}>{section.props.body}</p> : null}
    </Section>
  );

  const ImageText: SectionComponent<"imageText"> = ({ section, ctx }) => {
    const img = sectionImage(ctx, section.props.imageId);
    return (
      <Section id={section.id} alt>
        <div className={s.split}>
          <div>
            <h2 id={`${section.id}-title`} className={s.sectionTitle}>
              {section.props.title}
            </h2>
            {section.props.body ? <p className={s.prose}>{section.props.body}</p> : null}
          </div>
          <div className={s.splitArt}>
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={s.img} src={img.url} alt="" width={img.width} height={img.height} loading="lazy" decoding="async" />
            ) : (
              <Placeholder text={section.props.title} />
            )}
          </div>
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
          <h2 id={`${section.id}-title`} className={s.ctaTitle}>
            {section.props.title}
          </h2>
          {section.props.buttonText && (
            <a className={s.btn} href={ctx.href(section.props.buttonLink)}>
              {section.props.buttonText}
            </a>
          )}
        </div>
      </div>
    </section>
  );

  // ---- kit sections (namespaced by the theme) ----

  const str = (v: unknown) => (typeof v === "string" ? v : "");

  /** The store's categories as tiles; each shows the image of the category's first product that has one. */
  const Categories: ExtraSectionComponent = ({ section, ctx }) => {
    const { categories, products } = ctx.data;
    if (categories.length === 0) return null;
    const title = str(section.props.title);
    return (
      <Section id={section.id} title={title || undefined} className={s.tilesSection}>
        <ul className={s.tiles} aria-label={title ? undefined : "دسته‌بندی‌ها"}>
          {categories.slice(0, 12).map((c) => {
            const withImage = products.find((p) => p.categoryId === c.id && p.image);
            const url = withImage?.image ? ctx.mediaUrl(withImage.image.key) : null;
            return (
              <li key={c.id}>
                <a className={s.tile} href={listUrl(ctx, { category: c.slug })}>
                  <span className={s.tileArt}>
                    {url && withImage?.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={s.img} src={url} alt="" width={withImage.image.width} height={withImage.image.height} loading="lazy" decoding="async" />
                    ) : (
                      <Placeholder text={c.name} />
                    )}
                  </span>
                  <span className={s.tileName}>{c.name}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </Section>
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
              {it.label && <span className={s.highlightTitle}>{it.label}</span>}
              <span className={s.highlightText}>{it.value}</span>
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
            <div>
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
  const extraSections: Record<string, ExtraSectionComponent> = { [`${key}.categories`]: Categories, [`${key}.highlights`]: Highlights };
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
