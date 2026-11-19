import type { ReactNode } from "react";
import { CardSpecs, ProductSpecs } from "../engine/Specs";
import { formatNumberFa, formatToman } from "@/lib/money";
import { buildContactLinks } from "../engine/links";
import { categoryOf, featuredProducts, listProducts, listUrl, sectionImage } from "../engine/listing";
import { parseLabelLines } from "../engine/lines";
import type { ExtraSectionComponent, RenderContext, SectionComponent } from "../types";
import type { StorefrontProduct } from "../storefront-data";
import { initial } from "./Layout";
import s from "./appliances.module.css";

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

function StockText({ stock }: { stock: number }) {
  if (stock <= 0) return <span className={`${s.stock} ${s.stockOut}`}>ناموجود</span>;
  if (stock <= 5) return <span className={`${s.stock} ${s.stockLow}`}>تنها {formatNumberFa(stock)} عدد باقی مانده</span>;
  return <span className={s.stock}>موجود</span>;
}

function Art({ product, ctx, eager }: { product: StorefrontProduct; ctx: RenderContext; eager?: boolean }) {
  const url = product.image ? ctx.mediaUrl(product.image.key) : null;
  if (!product.image || !url) return <>{initial(product.name)}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={s.img} src={url} alt={eager ? product.name : ""} width={product.image.width} height={product.image.height} loading={eager ? "eager" : "lazy"} decoding="async" />;
}

function Grid({ ctx, items }: { ctx: RenderContext; items: StorefrontProduct[] }) {
  return (
    <ul className={s.grid}>
      {items.map((p) => {
        const category = categoryOf(ctx, p.categoryId);
        return (
          <li key={p.id}>
            <article className={s.card}>
              <div className={s.cardArt} aria-hidden={p.image ? undefined : "true"}>
                <Art product={p} ctx={ctx} />
              </div>
              <div className={s.cardBody}>
                {category && <span className={s.cardCategory}>{category.name}</span>}
                <h3 style={{ fontSize: "1em" }}>
                  <a className={s.cardName} href={ctx.href(`/products/${encodeURIComponent(p.slug)}`)}>
                    {p.name}
                  </a>
                </h3>
                <CardSpecs specs={p.specs} classes={{ list: s.cardSpecs, row: s.cardSpecRow, term: s.cardSpecTerm, def: s.cardSpecDef }} />
                <p className={s.price}>{formatToman(p.price)}</p>
                <StockText stock={p.stockQuantity} />
              </div>
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
          <Grid ctx={ctx} items={items} />
          {ctx.data.products.length > items.length && (
            <p style={{ marginTop: 32, textAlign: "center" }}>
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
    <div className={s.container} style={{ paddingTop: 36 }}>
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
          <Grid ctx={ctx} items={list.items} />
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
          <div className={s.detailArtWrap}>
            <div className={s.detailArt} aria-hidden={p.image ? undefined : "true"}>
              <Art product={p} ctx={ctx} eager />
            </div>
          </div>
          <div>
            <h1 id={`${section.id}-title`} className={s.detailTitle}>
              {p.name}
            </h1>
            <p className={s.detailPrice}>{formatToman(p.price)}</p>
            <StockText stock={p.stockQuantity} />
            {p.description ? (
              <p className={s.prose} style={{ marginTop: 20 }}>
                {p.description}
              </p>
            ) : null}
            <p className={s.note}>برای سفارش با فروشگاه تماس بگیرید. خرید آنلاین در این نسخه فعال نیست.</p>
          </div>
        </div>
        <ProductSpecs specs={p.specs} classes={{ wrap: s.specs, title: s.specsTitle, list: s.specsList, row: s.specsRow, term: s.specsTerm, def: s.specsDef }} />
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

/** `appliances.serviceInfo`: warranty / delivery / after-sales points from "title: text" lines (escaped text). */
export const ServiceInfo: ExtraSectionComponent = ({ section }) => {
  const p = section.props as { title: string; items: string; note: string };
  const items = parseLabelLines(p.items);
  return (
    <Section id={section.id} title={p.title}>
      {items.length > 0 && (
        <ul className={s.service}>
          {items.map((it, i) => (
            <li key={i} className={s.serviceItem}>
              {it.label && <strong className={s.serviceLabel}>{it.label}</strong>}
              <span>{it.value}</span>
            </li>
          ))}
        </ul>
      )}
      {p.note && <p className={s.tableNote}>{p.note}</p>}
    </Section>
  );
};
