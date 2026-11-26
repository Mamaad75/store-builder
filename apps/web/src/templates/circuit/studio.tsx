import { circuitStudioTheme as definition } from "@store-builder/shared/templates/kit/themes";
import { featuredProducts, listProducts, productsInCategory, relatedProducts } from "@store-builder/shared/templates/engine/listing";
import { formatNumberFa as fa } from "@store-builder/shared/lib/money";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { frame, frameProps, Skip, MissingHeading, Tiles, Promos, Highlights, About, Story, Contact, Call, Empty, enter, Brand, Search, Pages, Contacts, HeroLink, Art, Stock, Price, Variants, Specs, productHref, ListingTitle, Sort, Pager, Filter, OrderLinks } from "../kit/primitives";
import { Icon } from "../kit/icons";
import type { LayoutProps, RenderContext, SectionComponent, TemplateModule } from "../types";
import s from "./studio.module.css";
import ShopNav from "../commerce/ShopNav";
import EnamadSeal from "../common/EnamadSeal";
import { GalleryStrip } from "../common/GalleryStrip";

function Layout({ ctx, children }: LayoutProps) {

  return <div {...frameProps(ctx)} className={`${frame} ${s.root}`} data-storefront-layout="circuit">
    <Skip />
    <header className={s.header}><div><Brand ctx={ctx} /><Search ctx={ctx} /><ShopNav ctx={ctx} /></div><Pages ctx={ctx} /></header>
    <main id="main" tabIndex={-1} className={s.main}><MissingHeading ctx={ctx} />{children}</main>
    <footer className={s.footer}><div><Icon name="shield" /> <Brand ctx={ctx} /><Contacts ctx={ctx} /></div><Pages ctx={ctx} label="پیوندهای پایانی" /><EnamadSeal enamad={ctx.data.store.enamad} /></footer>
  </div>;
}

const Hero: SectionComponent<"hero"> = ({ ctx, section }) => (
  <section className={s.hero} data-structure="spec-hero"><div className={enter}><h1>{section.props.title}</h1><p>{section.props.subtitle}</p><HeroLink ctx={ctx} text={section.props.buttonText} path={section.props.buttonLink} /><dl><div><dt>کالا در فروشگاه</dt><dd>{fa(ctx.data.products.length)}</dd></div><div><dt>دسته‌بندی</dt><dd>{fa(ctx.data.categories.length)}</dd></div></dl></div><figure><Art ctx={ctx} imageId={section.props.imageId} priority fallbackProduct /></figure></section>
);

function Cards({ ctx, items, heading: Title = "h3" }: { ctx: RenderContext; items: StorefrontProduct[]; heading?: "h2" | "h3" }) {
  return <ul className={s.cards} data-structure="spec-rows">{items.map((p) => <li key={p.id}><figure><Art ctx={ctx} product={p} /></figure><div><Title><a href={productHref(ctx,p)}>{p.name}</a></Title><Stock product={p} /><Price product={p} /></div><div className={s.technical}><Specs product={p} /></div></li>)}</ul>;
}

const Grid: SectionComponent<"productGrid"> = ({ ctx, section }) => {
  const result = listProducts(ctx);
  return <section className={s.listing} data-structure="technical-catalog"><header><ListingTitle result={result} title={section.props.title} /><Sort ctx={ctx} result={result} /></header>{result.items.length ? <Cards ctx={ctx} items={result.items} heading="h2" /> : <Empty />}<Pager ctx={ctx} result={result} /></section>;
};

const Detail: SectionComponent<"productDetail"> = ({ ctx }) => {
  const p = ctx.product;
  if (!p) return null;

  const related = relatedProducts(ctx, p, 6);
  return <>
    <article className={s.detail} data-structure="sticky-tech-gallery"><figure><Art ctx={ctx} product={p} alt={p.name} priority /><GalleryStrip ctx={ctx} product={p} /></figure><div><h1>{p.name}</h1><div className={s.purchase}><Stock product={p} /><Price product={p} /><Variants product={p} /><OrderLinks ctx={ctx} product={p} /></div><details open><summary>مشخصات</summary><Specs product={p} full /></details><details open><summary>توضیحات</summary><p>{p.description || "توضیحی برای این محصول ثبت نشده است."}</p></details></div></article>
    {related.length > 0 && <section className={s.featured}><h2>کالاهای مشابه</h2><Cards ctx={ctx} items={related} /></section>}
  </>;
};

export const circuitTemplateV3: TemplateModule = {
  definition, key: definition.key, version: definition.version, name: definition.meta.name, editor: definition.editor, Layout,
  sections: {
    hero: Hero, productGrid: Grid, productDetail: Detail,
    featuredProducts: ({ ctx, section }) => {
      const items = featuredProducts(ctx, section.props.limit);
      return <section className={s.featured}><h2>{section.props.title}</h2>{items.length ? <Cards ctx={ctx} items={items} /> : <Empty />}</section>;
    },
    categoryFilter: ({ ctx }) => <div className={s.filters}><Filter ctx={ctx} /></div>, richText: About, imageText: Story, contactInfo: Contact, callToAction: Call,
  },
  extraSections: {
    "circuit.categories": Tiles, "circuit.promos": Promos, "circuit.highlights": Highlights,
    "circuit.categoryRows": ({ ctx }) => <>{ctx.data.categories.map((category) => {
      const items = productsInCategory(ctx, category.id, 8);
      return items.length > 1 ? <section key={category.id} className={s.featured}><h2>{category.name}</h2><Cards ctx={ctx} items={items} /></section> : null;
    })}</>,

  },
};
