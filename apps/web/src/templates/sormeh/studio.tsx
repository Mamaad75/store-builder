import { sormehStudioTheme as definition } from "@store-builder/shared/templates/kit/themes";
import { featuredProducts, listProducts, productsInCategory, relatedProducts } from "@store-builder/shared/templates/engine/listing";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { frame, frameProps, Skip, MissingHeading, Tiles, Promos, Highlights, About, Story, Contact, Call, Empty, enter, Brand, SiteSearch, Pages, Contacts, HeroLink, Art, Stock, Price, Variants, Specs, productHref, ListingTitle, Sort, Pager, Filter, OrderLinks } from "../kit/primitives";
import type { LayoutProps, RenderContext, SectionComponent, TemplateModule } from "../types";
import s from "./studio.module.css";
import ShopNav from "../commerce/ShopNav";

function Layout({ ctx, children }: LayoutProps) {

  return <div {...frameProps(ctx)} className={`${frame} ${s.root}`} data-storefront-layout="sormeh">
    <Skip />
    <header className={s.header}><div className={s.headTools}><SiteSearch ctx={ctx} /><ShopNav ctx={ctx} /></div><Brand ctx={ctx} /><Pages ctx={ctx} /></header>
    <main id="main" tabIndex={-1} className={s.main}><MissingHeading ctx={ctx} />{children}</main>
    <footer className={s.footer}><div><Brand ctx={ctx} /><p>راه‌های ارتباط و دنبال‌کردن فروشگاه</p><Contacts ctx={ctx} /></div><Pages ctx={ctx} label="پیوندهای پایانی" /></footer>
  </div>;
}

const Hero: SectionComponent<"hero"> = ({ ctx, section }) => (
  <section className={s.hero} data-structure="beauty-arch"><figure className={enter}><Art ctx={ctx} imageId={section.props.imageId} priority fallbackProduct /></figure><div><h1>{section.props.title}</h1><p>{section.props.subtitle}</p><HeroLink ctx={ctx} text={section.props.buttonText} path={section.props.buttonLink} /></div></section>
);

function Cards({ ctx, items, heading: Title = "h3" }: { ctx: RenderContext; items: StorefrontProduct[]; heading?: "h2" | "h3" }) {
  return <div className={s.cards} data-structure="beauty-gallery">{items.map((p) => <article key={p.id}><figure><Art ctx={ctx} product={p} /></figure><Title><a href={productHref(ctx,p)}>{p.name}</a></Title><p><Price product={p} /></p><Stock product={p} /><Specs product={p} /></article>)}</div>;
}

const Grid: SectionComponent<"productGrid"> = ({ ctx, section }) => {
  const result = listProducts(ctx);
  return <section className={s.listing} data-structure="beauty-catalog"><div className={s.intro}><ListingTitle result={result} title={section.props.title} /></div><Sort ctx={ctx} result={result} />{result.items.length ? <Cards ctx={ctx} items={result.items} heading="h2" /> : <Empty />}<Pager ctx={ctx} result={result} /></section>;
};

const Detail: SectionComponent<"productDetail"> = ({ ctx }) => {
  const p = ctx.product;
  if (!p) return null;

  const related = relatedProducts(ctx, p, 6);
  return <>
    <article className={s.detail} data-structure="beauty-column"><h1>{p.name}</h1><figure><Art ctx={ctx} product={p} alt={p.name} priority /></figure><div className={s.purchase}><Price product={p} /><Stock product={p} /></div><p>{p.description}</p><Variants product={p} /><OrderLinks ctx={ctx} product={p} /><Specs product={p} full /></article>
    {related.length > 0 && <section className={s.featured}><h2>کالاهای مشابه</h2><Cards ctx={ctx} items={related} /></section>}
  </>;
};

export const sormehTemplateV3: TemplateModule = {
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
    "sormeh.categories": Tiles, "sormeh.promos": Promos, "sormeh.highlights": Highlights,
    "sormeh.categoryRows": ({ ctx }) => <>{ctx.data.categories.map((category) => {
      const items = productsInCategory(ctx, category.id, 8);
      return items.length > 1 ? <section key={category.id} className={s.featured}><h2>{category.name}</h2><Cards ctx={ctx} items={items} /></section> : null;
    })}</>,

  },
};
