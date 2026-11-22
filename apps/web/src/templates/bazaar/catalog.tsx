import { formatNumberFa, formatToman } from "@store-builder/shared/lib/money";
import { categoryOf, featuredProducts, listProducts, listUrl, productsInCategory, relatedProducts } from "@store-builder/shared/templates/engine/listing";
import { buildContactLinks } from "@store-builder/shared/templates/engine/links";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import type { ProductSort } from "@store-builder/shared/templates/context-types";
import { CardSpecs, ProductSpecs } from "../engine/Specs";
import { pageWindow } from "../kit/kit";
import { Icon } from "../kit/icons";
import type { ExtraSectionComponent, RenderContext, SectionComponent } from "../types";
import s from "./market.module.css";

const sorts: [ProductSort | undefined, string][] = [[undefined, "پیشنهاد فروشگاه"], ["cheap", "ارزان‌ترین"], ["expensive", "گران‌ترین"], ["available", "موجودها اول"]];

export function ProductImage({ ctx, product, detail = false }: { ctx: RenderContext; product: StorefrontProduct; detail?: boolean }) {
  const url = product.image && ctx.mediaUrl(product.image.key);
  if (!url || !product.image) return <span className={s.placeholder}><Icon name="bag" size={42} /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} width={product.image.width} height={product.image.height} alt={detail ? product.name : ""} loading={detail ? "eager" : "lazy"} fetchPriority={detail ? "high" : undefined} decoding="async" />;
}

function Cards({ ctx, products, rail = false, label }: { ctx: RenderContext; products: StorefrontProduct[]; rail?: boolean; label?: string }) {
  const CardTitle = rail ? "h3" : "h2";
  const cards = (
    <ul className={rail ? s.rail : s.grid} data-bazaar-catalog={rail ? "rail" : "grid"}>
      {products.map((product) => {
        const category = categoryOf(ctx, product.categoryId);
        return (
          <li key={product.id} className={s.card}>
            <div className={s.cardImage}><ProductImage ctx={ctx} product={product} /></div>
            {category && <p className={s.muted}>{category.name}</p>}
            <CardTitle><a href={ctx.href(`/products/${encodeURIComponent(product.slug)}`)}>{product.name}</a></CardTitle>
            <CardSpecs specs={product.specs} classes={{ list: s.cardSpecs, row: s.specRow, term: undefined, def: undefined }} />
            <div className={s.cardPrice}>
              <span className={product.stockQuantity > 0 ? s.inStock : s.muted}>{product.stockQuantity > 0 ? "موجود" : "ناموجود"}</span>
              <strong>{formatToman(product.price)}</strong>
            </div>
          </li>
        );
      })}
    </ul>
  );
  return rail ? <div className={s.scroll} role="region" aria-label={label} tabIndex={0}>{cards}</div> : cards;
}

export const Featured: SectionComponent<"featuredProducts"> = ({ section, ctx }) => {
  const products = featuredProducts(ctx, section.props.limit);
  return <section className={s.featured} aria-labelledby={section.id}>
    <div className={s.sectionHead}><h2 id={section.id}>{section.props.title}</h2><a href={ctx.href("/products")}>همهٔ محصولات</a></div>
    {products.length > 0 ? <Cards ctx={ctx} products={products} rail label={section.props.title} /> : <p>هنوز محصولی منتشر نشده است.</p>}
  </section>;
};

export const CategoryRows: ExtraSectionComponent = ({ section, ctx }) => (
  <>{ctx.data.categories.map((category, index) => {
    const products = productsInCategory(ctx, category.id, 8);
    if (!products.length) return null;
    const id = `${section.id}-${index}`;
    return <section className={s.panel} key={category.id} aria-labelledby={id}>
      <div className={s.sectionHead}><h2 id={id}>{category.name}</h2><a href={listUrl(ctx, { category: category.slug })}>مشاهدهٔ دسته</a></div>
      <Cards ctx={ctx} products={products} rail label={category.name} />
    </section>;
  })}</>
);

export const CategoryFilter: SectionComponent<"categoryFilter"> = ({ section, ctx }) => {
  const { category, q, sort } = ctx.query;
  if (!ctx.data.categories.length) return null;
  return <nav className={s.filter} id={section.id} aria-label="فیلتر دسته‌بندی">
    <a href={listUrl(ctx, { q, sort })} aria-current={!category ? "true" : undefined}>همه</a>
    {ctx.data.categories.map((item) => <a key={item.id} href={listUrl(ctx, { category: item.slug, q, sort })} aria-current={category === item.slug ? "true" : undefined}>{item.name}</a>)}
  </nav>;
};

export const ProductGrid: SectionComponent<"productGrid"> = ({ section, ctx }) => {
  const { category, q, sort, total, page, totalPages, items } = listProducts(ctx);
  const url = (next: number) => listUrl(ctx, { category: category?.slug, q, sort, page: next });
  const Title = ctx.page.type === "PRODUCTS" ? "h1" : "h2";
  return <section className={s.panel} data-bazaar-region="catalog" aria-labelledby={section.id}>
    <div className={s.sectionHead}>
      <Title id={section.id}>{q ? `جستجو: «${q}»` : category?.name ?? section.props.title}</Title>
      <p className={s.muted}>{formatNumberFa(total)} کالا</p>
    </div>
    <nav className={s.filter} aria-label="مرتب‌سازی محصولات">
      {sorts.map(([key, label]) => <a key={label} href={listUrl(ctx, { category: category?.slug, q, sort: key })} aria-current={sort === key ? "true" : undefined}>{label}</a>)}
    </nav>
    {q && <p className={s.clearSearch}><a href={listUrl(ctx, { category: category?.slug, sort })}>پاک کردن جستجو</a></p>}
    {items.length > 0 ? <Cards ctx={ctx} products={items} /> : <p className={s.empty}>{q ? "محصولی با این عبارت پیدا نشد." : "هنوز محصولی در این فهرست وجود ندارد."}</p>}
    {totalPages > 1 && <nav className={s.pagination} aria-label="صفحه‌بندی محصولات">
      {page > 1 && <a href={url(page - 1)} rel="prev">قبلی</a>}
      {pageWindow(page, totalPages).map((n, index) => n === null ? <span key={`gap-${index}`}>…</span> : <a key={n} href={url(n)} aria-label={`صفحهٔ ${formatNumberFa(n)}`} aria-current={page === n ? "page" : undefined}>{formatNumberFa(n)}</a>)}
      {page < totalPages && <a href={url(page + 1)} rel="next">بعدی</a>}
    </nav>}
  </section>;
};

export const ProductDetail: SectionComponent<"productDetail"> = ({ ctx, section }) => {
  const product = ctx.product;
  if (!product) return null;
  const category = categoryOf(ctx, product.categoryId);
  const order = buildContactLinks(ctx.data.store.contact, ctx.data.store.social).filter((link) => link.kind === "phone" || link.kind === "whatsapp");
  const related = relatedProducts(ctx, product, 8);
  return <>
    <nav className={s.crumbs} aria-label="مسیر محصول">
      <a href={ctx.href("/products")}>محصولات</a>
      {category && <a href={listUrl(ctx, { category: category.slug })}>{category.name}</a>}
      <span aria-current="page">{product.name}</span>
    </nav>
    <section className={s.detail} data-bazaar-region="product-summary" aria-labelledby={section.id}>
      <div className={s.detailImage}><ProductImage ctx={ctx} product={product} detail /></div>
      <div className={s.detailInfo}>
        <h1 id={section.id}>{product.name}</h1>
        {product.description && <p className={s.prose}>{product.description}</p>}
        <aside className={s.purchase} aria-label="قیمت و موجودی">
          <p className={product.stockQuantity > 0 ? s.inStock : s.muted}>{product.stockQuantity > 0 ? "موجود" : "ناموجود"}</p>
          <strong>{formatToman(product.price)}</strong>
          {product.stockQuantity > 0 && order.map((link) => <a key={link.kind} className={s.button} href={link.kind === "whatsapp" ? `${link.href}?text=${encodeURIComponent(`سلام، برای سفارش «${product.name}» پیام می‌دهم.`)}` : link.href}>{link.kind === "phone" ? "تماس برای سفارش" : "سفارش در واتساپ"}</a>)}
        </aside>
      </div>
    </section>
    <ProductSpecs specs={product.specs} classes={{ wrap: s.panel, title: undefined, list: s.detailSpecs, row: s.specRow, term: undefined, def: undefined }} />
    {related.length > 0 && <section className={s.panel} aria-label="کالاهای مشابه"><h2>کالاهای مشابه</h2><Cards ctx={ctx} products={related} rail label="کالاهای مشابه" /></section>}
  </>;
};
