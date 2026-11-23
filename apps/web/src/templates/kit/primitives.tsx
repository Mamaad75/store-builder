import { storyImage } from "./story-image";
import type { ReactNode } from "react";
import { formatNumberFa, formatToman } from "@store-builder/shared/lib/money";
import { formTarget, listProducts, listUrl, sectionImage } from "@store-builder/shared/templates/engine/listing";
import { buildContactLinks } from "@store-builder/shared/templates/engine/links";
import { SEARCH_MAX } from "@store-builder/shared/templates/engine/route";
import { parseLabelLines, parseTable } from "@store-builder/shared/templates/engine/lines";
import { productPriceLabel, type StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { navItems, themeStyleVars } from "../engine/theme-vars";
import { CardSpecs, ProductSpecs } from "../engine/Specs";
import type { ExtraSectionComponent, RenderContext, SectionComponent } from "../types";
import { pageWindow } from "./kit";
import { Icon } from "./icons";
import s from "./primitives.module.css";
import BuyBox from "../commerce/BuyBox";

export const frame = s.frame!;
export const enter = s.enter!;
export const action = s.action!;
export const productHref = (ctx: RenderContext, p: StorefrontProduct) => ctx.href(`/products/${encodeURIComponent(p.slug)}`);

export function frameProps(ctx: RenderContext) {
  const { store, template } = ctx.data;
  return { dir: store.direction, lang: store.direction === "rtl" ? "fa" : "en", style: themeStyleVars(store), "data-template": template.key };
}

export function Skip() { return <a className={s.skip} href="#main">پرش به محتوا</a>; }

export function Brand({ ctx }: { ctx: RenderContext }) {
  const { store } = ctx.data;
  const logo = store.logo && ctx.mediaUrl(store.logo.key);
  return <a className={s.brand} href={ctx.href("/")}>
    {logo && store.logo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo} alt="" width={store.logo.width} height={store.logo.height} />
    ) : <Icon name="bag" />}
    {store.name}
  </a>;
}

export function Pages({ ctx, label = "ناوبری اصلی" }: { ctx: RenderContext; label?: string }) {
  return <nav className={s.links} aria-label={label}>{navItems(ctx).map((page) => <a key={page.type} href={ctx.href(page.path)} aria-current={page.current ? "page" : undefined}>{page.title}</a>)}</nav>;
}

export function Categories({ ctx, label = "دسته‌بندی کالاها" }: { ctx: RenderContext; label?: string }) {
  if (!ctx.data.categories.length) return null;
  return <nav className={s.links} aria-label={label}>{ctx.data.categories.map((category) => <a key={category.id} href={listUrl(ctx, { category: category.slug })}>{category.name}</a>)}</nav>;
}

export function Search({ ctx }: { ctx: RenderContext }) {
  const target = formTarget(ctx, "/products");
  return <form role="search" action={target.action} className={s.search}>
    {target.hidden.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    <input name="q" type="search" aria-label="جستجو در محصولات" placeholder="جستجوی کالا" maxLength={SEARCH_MAX} defaultValue={ctx.query.q} />
    <button aria-label="جستجو"><Icon name="search" /></button>
  </form>;
}

export function SiteSearch({ ctx }: { ctx: RenderContext }) {
  return <details className={s.disclosure}><summary>جستجو</summary><Search ctx={ctx} /></details>;
}

export function Contacts({ ctx }: { ctx: RenderContext }) {
  const links = buildContactLinks(ctx.data.store.contact, ctx.data.store.social);
  if (!links.length) return null;
  return <address className={s.contacts}>{links.map((link) => link.href
    ? <a key={link.kind} href={link.href}>{link.label} <bdi>{link.value}</bdi></a>
    : <span key={link.kind}>{link.value}</span>)}</address>;
}

export function OrderLinks({ ctx, product }: { ctx: RenderContext; product?: StorefrontProduct }) {
  if (product && product.stockQuantity <= 0) return null;
  return <>{product && <BuyBox ctx={ctx} product={product} />}<div className={s.links}>{buildContactLinks(ctx.data.store.contact, ctx.data.store.social)
    .filter((link) => link.kind === "phone" || link.kind === "whatsapp")
    .map((link) => <a className={s.action} key={link.kind} href={link.kind === "whatsapp" && product
      ? `${link.href}?text=${encodeURIComponent(`سلام، برای سفارش «${product.name}» پیام می‌دهم.`)}` : link.href}>{link.kind === "phone" ? "تماس برای سفارش" : "سفارش در واتساپ"}</a>)}</div></>;
}

export function Art({ ctx, product, imageId, priority = false, alt = "", fallbackProduct = false }: {
  ctx: RenderContext; product?: StorefrontProduct; imageId?: string | null; priority?: boolean; alt?: string; fallbackProduct?: boolean;
}) {
  const banner = imageId ? sectionImage(ctx, imageId) : null;
  const ref = product?.image ?? (!banner && fallbackProduct ? ctx.data.products.find((item) => item.image)?.image : null);
  const image = banner ?? (ref ? { ...ref, url: ctx.mediaUrl(ref.key) } : null);
  if (!image?.url) return <span className={s.placeholder} aria-hidden="true"><Icon name="bag" size={48} /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={s.image} src={image.url} width={image.width} height={image.height} alt={alt} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" />;
}

export function Price({ product }: { product: StorefrontProduct }) { return <strong className={s.price}>{productPriceLabel(product)}</strong>; }
/** Phase 3.2 (D32-1): the purchasable combinations with their own price and stock, on every product page. */
export function Variants({ product }: { product: StorefrontProduct }) {
  if (product.variants.length === 0) return null;
  return (
    <table className={s.variants}>
      <caption>تنوع‌ها</caption>
      <thead><tr><th scope="col">{product.variants[0]!.options.map((o) => o.name).join(" / ")}</th><th scope="col">قیمت</th><th scope="col">وضعیت</th></tr></thead>
      <tbody>
        {product.variants.map((v) => (
          <tr key={v.id} data-available={v.stockQuantity > 0}>
            <th scope="row">{v.options.map((o) => o.value).join(" / ")}</th>
            <td>{formatToman(v.price)}</td>
            <td>{v.stockQuantity > 0 ? "موجود" : "ناموجود"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function Stock({ product }: { product: StorefrontProduct }) { return <span className={s.stock} data-available={product.stockQuantity > 0}>{product.stockQuantity > 0 ? "موجود" : "ناموجود"}</span>; }
const specClasses = { wrap: s.specs, title: undefined, list: s.specList, row: s.specRow, term: undefined, def: undefined };
export function Specs({ product, full = false }: { product: StorefrontProduct; full?: boolean }) {
  return full ? <ProductSpecs specs={product.specs} classes={specClasses} /> : <CardSpecs specs={product.specs} classes={specClasses} />;
}

export function Filter({ ctx }: { ctx: RenderContext }) {
  if (!ctx.data.categories.length) return null;
  const { category, q, sort } = ctx.query;
  return <nav className={s.links} aria-label="فیلتر دسته‌ها">
    <a href={listUrl(ctx, { q, sort })} aria-current={!category ? "true" : undefined}>همه</a>
    {ctx.data.categories.map((item) => <a key={item.id} href={listUrl(ctx, { category: item.slug, q, sort })} aria-current={category === item.slug ? "true" : undefined}>{item.name}</a>)}
  </nav>;
}

type Listing = ReturnType<typeof listProducts>;
export function ListingTitle({ result, title }: { result: Listing; title: string }) {
  return <><h1>{result.q ? `جستجو: «${result.q}»` : result.category?.name ?? title}</h1><p>{formatNumberFa(result.total)} کالا</p></>;
}
export function Sort({ ctx, result }: { ctx: RenderContext; result: Listing }) {
  const labels = { cheap: "ارزان‌ترین", expensive: "گران‌ترین", available: "موجودها اول" } as const;
  const url = (sort?: keyof typeof labels) => listUrl(ctx, { category: result.category?.slug, q: result.q, sort });
  return <nav className={s.links} aria-label="مرتب‌سازی">
    <a href={url()} aria-current={!result.sort ? "true" : undefined}>پیشنهاد فروشگاه</a>
    {Object.entries(labels).map(([key, label]) => <a key={key} href={url(key as keyof typeof labels)} aria-current={result.sort === key ? "true" : undefined}>{label}</a>)}
    {result.q && <a href={listUrl(ctx, { category: result.category?.slug, sort: result.sort })}>پاک کردن جستجو</a>}
  </nav>;
}
export function Pager({ ctx, result }: { ctx: RenderContext; result: Listing }) {
  if (result.totalPages <= 1) return null;
  return <nav className={s.links} aria-label="صفحه‌بندی">
    {pageWindow(result.page, result.totalPages).map((page, i) => page == null ? <span key={i}>…</span> :
      <a key={i} aria-label={`صفحهٔ ${formatNumberFa(page)}`} aria-current={result.page === page ? "page" : undefined}
        href={listUrl(ctx, { category: result.category?.slug, q: result.q, sort: result.sort, page })}>{formatNumberFa(page)}</a>)}
  </nav>;
}

export const About: SectionComponent<"richText"> = ({ ctx, section }) => {
  const Title = ctx.page.type === "ABOUT" && ctx.page.sections.find((item) => item.type === "richText")?.id === section.id ? "h1" : "h2";
  return <section className={s.copy}><Title>{section.props.title}</Title><p>{section.props.body}</p></section>;
};
export const Story: SectionComponent<"imageText"> = ({ ctx, section }) => {
  const image = storyImage({ ctx, section });
  return <section className={s.story}>
    <div><h2>{section.props.title}</h2><p>{section.props.body}</p></div>
    {image && (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={s.image} src={image.url} width={image.width} height={image.height} alt="" loading="lazy" decoding="async" />
    )}
  </section>;
};
export const Contact: SectionComponent<"contactInfo"> = ({ ctx, section }) => {
  const Title = ctx.page.type === "CONTACT" ? "h1" : "h2";
  return <section className={s.copy}><Title>{section.props.title}</Title><p>{section.props.body}</p><Contacts ctx={ctx} /></section>;
};
export const Call: SectionComponent<"callToAction"> = ({ ctx, section }) => <section className={s.copy}>
  <h2>{section.props.title}</h2><a className={s.action} href={ctx.href(section.props.buttonLink)}>{section.props.buttonText}</a>
</section>;

export function MissingHeading({ ctx }: { ctx: RenderContext }) {
  const expected = ctx.page.type === "HOME" ? "hero" : ctx.page.type === "ABOUT" ? "richText" : null;
  return expected && !ctx.page.sections.some((section) => section.type === expected) ? <h1>{ctx.page.title}</h1> : null;
}

export function HeroLink({ ctx, text, path }: { ctx: RenderContext; text: string; path: string }) {
  return text ? <a className={s.action} href={ctx.href(path)}>{text}<Icon name="chevron" size={16} /></a> : null;
}

export const Tiles: ExtraSectionComponent = ({ ctx, section }) => ctx.data.categories.length ? <section className={s.copy}>
  <h2>{String(section.props.title || "بر اساس دسته")}</h2><Categories ctx={ctx} />
</section> : null;

export const Promos: ExtraSectionComponent = ({ ctx, section }) => {
  const rows = String(section.props.items ?? "").split("\n").map((row) => row.split("|").map((part) => part.trim())).filter(([title]) => title);
  return rows.length ? <section className={s.promos} aria-label={String(section.props.title || "پیشنهادهای فروشگاه")}>
    {rows.map(([title, body, name], i) => <a key={i} href={listUrl(ctx, { category: ctx.data.categories.find((item) => item.name === name)?.slug })}><strong>{title}</strong>{body && <span>{body}</span>}</a>)}
  </section> : null;
};

export const Highlights: ExtraSectionComponent = ({ section }) => {
  const rows = parseLabelLines(String(section.props.items ?? ""));
  return rows.length ? <section className={s.copy} aria-label={String(section.props.title || "راهنمای فروشگاه")}><ul className={s.highlights}>
    {rows.map((row, i) => <li key={i}><Icon name="check" /><span><strong>{row.label}</strong> {row.value}</span></li>)}
  </ul></section> : null;
};

export function Rows({ section, ordered = false }: { section: Parameters<ExtraSectionComponent>[0]["section"]; ordered?: boolean }) {
  const rows = parseLabelLines(String(section.props.items ?? ""));
  const List = ordered ? "ol" : "ul";
  return <><h2>{String(section.props.title ?? "")}</h2>
    <List>{rows.map((row, i) => <li key={i}><strong>{row.label}</strong><span>{row.value}</span></li>)}</List>
    {Boolean(section.props.note) && <p>{String(section.props.note)}</p>}</>;
}
export function SizeGuide({ section }: { section: Parameters<ExtraSectionComponent>[0]["section"] }) {
  const table = parseTable(String(section.props.table ?? ""));
  return <details className={s.disclosure}><summary>{String(section.props.title || "راهنمای اندازه")}</summary>
    {Boolean(section.props.intro) && <p>{String(section.props.intro)}</p>}
    {table && <table><thead><tr>{table.head.map((cell, i) => <th scope="col" key={i}>{cell}</th>)}</tr></thead>
      <tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table>}
    {Boolean(section.props.note) && <p>{String(section.props.note)}</p>}
  </details>;
}

export function Empty({ children }: { children?: ReactNode }) {
  return <p className={s.copy}>{children ?? "هنوز محصولی در این فهرست وجود ندارد."}</p>;
}
