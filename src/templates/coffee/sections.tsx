import type { ReactNode } from "react";
import { formatNumberFa, formatToman } from "@/lib/money";
import { buildContactLinks } from "../engine/links";
import { categoryOf, featuredProducts, listProducts, listUrl, sectionImage } from "../engine/listing";
import { parseLabelLines } from "../engine/lines";
import type { ExtraSectionComponent, RenderContext, SectionComponent } from "../types";
import type { StorefrontProduct } from "../storefront-data";
import { initial } from "./Layout";
import s from "./coffee.module.css";

function Section({ title, children, alt, id, level = 2 }: { title?: string; children: ReactNode; alt?: boolean; id: string; level?: 1 | 2 }) {
  const H = `h${level}` as "h1" | "h2";
  return (
    <section className={`${s.section} ${alt ? s.sectionAlt : ""}`} aria-labelledby={title ? `${id}-title` : undefined}>
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

function Stock({ stock }: { stock: number }) {
  if (stock <= 0) return <span className={`${s.badge} ${s.outOfStock}`}>ناموجود</span>;
  if (stock <= 5) return <span className={`${s.badge} ${s.lowStock}`}>تنها {formatNumberFa(stock)} عدد باقی مانده</span>;
  return <span className={`${s.badge} ${s.inStock}`}>موجود</span>;
}

function Thumb({ product, ctx }: { product: StorefrontProduct; ctx: RenderContext }) {
  const url = product.image ? ctx.mediaUrl(product.image.key) : null;
  if (!product.image || !url) return <>{initial(product.name)}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={s.img} src={url} alt="" width={product.image.width} height={product.image.height} loading="lazy" decoding="async" />;
}

/** Menu-style row: thumbnail, name, short description, stock and price. */
function MenuList({ ctx, items }: { ctx: RenderContext; items: StorefrontProduct[] }) {
  return (
    <ul className={s.menu}>
      {items.map((p) => {
        const category = categoryOf(ctx, p.categoryId);
        return (
          <li key={p.id}>
            <article className={s.row}>
              <div className={s.rowArt} aria-hidden={p.image ? undefined : "true"}>
                <Thumb product={p} ctx={ctx} />
              </div>
              <div>
                <h3 style={{ fontSize: "1em" }}>
                  <a className={s.rowName} href={ctx.href(`/products/${encodeURIComponent(p.slug)}`)}>
                    {p.name}
                  </a>
                </h3>
                {p.description && <p className={s.rowDesc}>{p.description}</p>}
                <div className={s.rowMeta}>
                  {category && <span>{category.name}</span>}
                  <Stock stock={p.stockQuantity} />
                </div>
              </div>
              <p className={s.price}>{formatToman(p.price)}</p>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

export const Hero: SectionComponent<"hero"> = ({ section, ctx }) => {
  const { title, subtitle, buttonText, buttonLink } = section.props;
  const img = sectionImage(ctx, section.props.imageId);
  return (
    <section className={s.hero} aria-labelledby={`${section.id}-title`}>
      <div className={`${s.container} ${s.heroInner}`}>
        <div>
          <span className={s.heroKicker}>{ctx.data.store.name}</span>
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
        <div className={s.heroArt} aria-hidden={img ? undefined : "true"}>
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={s.img} src={img.url} alt="" width={img.width} height={img.height} decoding="async" />
          ) : (
            initial(ctx.data.store.name)
          )}
        </div>
      </div>
    </section>
  );
};

export const FeaturedProducts: SectionComponent<"featuredProducts"> = ({ section, ctx }) => {
  const items = featuredProducts(ctx, section.props.limit);
  return (
    <Section id={section.id} title={section.props.title}>
      {items.length === 0 ? (
        <Empty title="هنوز محصولی منتشر نشده است" text="به‌زودی محصولات این فروشگاه اینجا نمایش داده می‌شود." />
      ) : (
        <>
          <MenuList ctx={ctx} items={items} />
          {ctx.data.products.length > items.length && (
            <p style={{ marginTop: 24, textAlign: "center" }}>
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

export const CategoryFilter: SectionComponent<"categoryFilter"> = ({ section, ctx }) => {
  const { categories } = ctx.data;
  if (categories.length === 0) return null;
  const active = ctx.query.category;
  return (
    <div className={s.container} style={{ paddingTop: 32 }}>
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

export const ProductGrid: SectionComponent<"productGrid"> = ({ section, ctx }) => {
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
          <MenuList ctx={ctx} items={list.items} />
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

export const ProductDetail: SectionComponent<"productDetail"> = ({ section, ctx }) => {
  const p = ctx.product;
  if (!p) return null;
  const category = categoryOf(ctx, p.categoryId);
  const url = p.image ? ctx.mediaUrl(p.image.key) : null;
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
          <div className={s.detailArt} aria-hidden={p.image && url ? undefined : "true"}>
            {p.image && url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={s.img} src={url} alt={p.name} width={p.image.width} height={p.image.height} loading="eager" decoding="async" />
            ) : (
              initial(p.name)
            )}
          </div>
          <div>
            <h1 id={`${section.id}-title`} className={s.detailTitle}>
              {p.name}
            </h1>
            <p className={s.detailPrice}>{formatToman(p.price)}</p>
            <Stock stock={p.stockQuantity} />
            {p.description ? (
              <p className={s.prose} style={{ marginTop: 18 }}>
                {p.description}
              </p>
            ) : null}
            <p className={s.note}>برای سفارش با فروشگاه تماس بگیرید. خرید آنلاین در این نسخه فعال نیست.</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export const RichText: SectionComponent<"richText"> = ({ section, ctx }) => (
  <Section id={section.id} title={section.props.title} level={ctx.page.type === "ABOUT" ? 1 : 2}>
    {section.props.body ? <p className={s.prose}>{section.props.body}</p> : null}
  </Section>
);

export const ImageText: SectionComponent<"imageText"> = ({ section, ctx }) => {
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
        <div className={s.splitArt} aria-hidden={img ? undefined : "true"}>
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={s.img} src={img.url} alt="" width={img.width} height={img.height} loading="lazy" decoding="async" />
          ) : (
            initial(section.props.title)
          )}
        </div>
      </div>
    </Section>
  );
};

export const ContactInfo: SectionComponent<"contactInfo"> = ({ section, ctx }) => {
  const links = buildContactLinks(ctx.data.store.contact, ctx.data.store.social);
  return (
    <Section id={section.id} title={section.props.title} level={ctx.page.type === "CONTACT" ? 1 : 2}>
      {section.props.body ? <p className={s.prose}>{section.props.body}</p> : null}
      {links.length === 0 ? (
        <div style={{ marginTop: 18 }}>
          <Empty title="اطلاعات تماس ثبت نشده است" text="فروشگاه هنوز راه ارتباطی اعلام نکرده است." />
        </div>
      ) : (
        <ul className={s.contactList}>
          {links.map((l) => (
            <li key={l.kind} className={s.contactItem}>
              <span className={s.contactLabel}>{l.label}</span>
              <span className={s.contactValue} dir={l.kind === "address" ? undefined : "ltr"}>
                {l.href ? (
                  <a href={l.href} rel={l.href.startsWith("http") ? "noopener noreferrer" : undefined} target={l.href.startsWith("http") ? "_blank" : undefined}>
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

export const CallToAction: SectionComponent<"callToAction"> = ({ section, ctx }) => (
  <section className={s.section} aria-labelledby={`${section.id}-title`}>
    <div className={s.container}>
      <div className={s.cta}>
        <h2 id={`${section.id}-title`}>{section.props.title}</h2>
        {section.props.buttonText && (
          <a className={s.btn} href={ctx.href(section.props.buttonLink)}>
            {section.props.buttonText}
          </a>
        )}
      </div>
    </div>
  </section>
);

/** `coffee.openingHours`: dotted-leader rows ("label ..... hours"). Props were validated by the theme's schema. */
export const OpeningHours: ExtraSectionComponent = ({ section, ctx }) => {
  const p = section.props as { title: string; body: string; note: string };
  const rows = parseLabelLines(p.body);
  return (
    <Section id={section.id} title={p.title} level={ctx.page.type === "CONTACT" ? 2 : 2}>
      <ul className={s.hours}>
        {rows.map((r, i) => (
          <li key={i} className={s.hoursRow}>
            {r.label && <span className={s.hoursLabel}>{r.label}</span>}
            <span className={s.hoursDots} aria-hidden="true" />
            <span className={s.hoursValue}>{r.value}</span>
          </li>
        ))}
      </ul>
      {p.note && <p className={s.hoursNote}>{p.note}</p>}
    </Section>
  );
};
