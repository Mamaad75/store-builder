import { sofrehStudioTheme as definition } from "@store-builder/shared/templates/kit/themes";
import { featuredProducts, listProducts, productsInCategory, relatedProducts } from "@store-builder/shared/templates/engine/listing";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { frame, frameProps, Skip, MissingHeading, Tiles, Promos, Highlights, About, Story, Contact, Call, Empty, enter, Brand, SiteSearch, Pages, Contacts, HeroLink, Art, Stock, Price, Variants, Specs, productHref, ListingTitle, Sort, Pager, Filter, OrderLinks, Rows } from "../kit/primitives";
import { Icon } from "../kit/icons";
import type { LayoutProps, RenderContext, SectionComponent, TemplateModule } from "../types";
import s from "./studio.module.css";
import ShopNav from "../commerce/ShopNav";
import EnamadSeal from "../common/EnamadSeal";

function Layout({ ctx, children }: LayoutProps) {

  return <div {...frameProps(ctx)} className={`${frame} ${s.root}`} data-storefront-layout="sofreh">
    <Skip />
    <header className={s.header}><div><Brand ctx={ctx} /><OrderLinks ctx={ctx} /><ShopNav ctx={ctx} /></div><nav aria-label="منوی کافه"><a href={ctx.href("/products")}>منو</a><a href={ctx.href("/contact")}>ساعت و نشانی</a><SiteSearch ctx={ctx} /></nav></header>
    <main id="main" tabIndex={-1} className={s.main}><MissingHeading ctx={ctx} />{children}</main>
    <footer className={s.footer}><div><Icon name="pin" size={30} /><h2>نشانی و تماس</h2><Contacts ctx={ctx} /></div><div><Pages ctx={ctx} label="پیوندهای پایانی" /><OrderLinks ctx={ctx} /></div><EnamadSeal enamad={ctx.data.store.enamad} /></footer>
  </div>;
}

const Hero: SectionComponent<"hero"> = ({ ctx, section }) => (
  <section className={s.hero} data-structure="short-cafe-strip"><div className={enter}><h1>{section.props.title}</h1><p>{section.props.subtitle}</p><HeroLink ctx={ctx} text={section.props.buttonText} path={section.props.buttonLink} /></div><div><Art ctx={ctx} imageId={section.props.imageId} priority fallbackProduct /></div></section>
);

function Cards({ ctx, items, heading: Title = "h3" }: { ctx: RenderContext; items: StorefrontProduct[]; heading?: "h2" | "h3" }) {
  return <ul className={s.cards} data-structure="menu-list">{items.map((p) => <li key={p.id}><span><Art ctx={ctx} product={p} /></span><div><Title><a href={productHref(ctx,p)}>{p.name}</a></Title><p>{p.description}</p><Specs product={p} /></div><div><Price product={p} /><Stock product={p} /></div></li>)}</ul>;
}

const Grid: SectionComponent<"productGrid"> = ({ ctx, section }) => {
  const result = listProducts(ctx);
  return <section className={s.listing} data-structure="menu-catalog"><header><ListingTitle result={result} title={section.props.title} /></header>{result.items.length ? <Cards ctx={ctx} items={result.items} heading="h2" /> : <Empty />}<footer><Sort ctx={ctx} result={result} /><Pager ctx={ctx} result={result} /></footer></section>;
};

const Detail: SectionComponent<"productDetail"> = ({ ctx }) => {
  const p = ctx.product;
  if (!p) return null;

  const related = relatedProducts(ctx, p, 6);
  return <>
    <article className={s.detail} data-structure="cafe-order-slip"><header><h1>{p.name}</h1><Stock product={p} /></header><figure><Art ctx={ctx} product={p} alt={p.name} priority /></figure><p>{p.description}</p><Specs product={p} full /><footer><Price product={p} /><Variants product={p} /><OrderLinks ctx={ctx} product={p} /></footer></article>
    {related.length > 0 && <section className={s.featured}><h2>کالاهای مشابه</h2><Cards ctx={ctx} items={related} /></section>}
  </>;
};

export const sofrehTemplateV3: TemplateModule = {
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
    "sofreh.categories": Tiles, "sofreh.promos": Promos, "sofreh.highlights": Highlights,
    "sofreh.categoryRows": ({ ctx }) => <>{ctx.data.categories.map((category) => {
      const items = productsInCategory(ctx, category.id, 8);
      return items.length > 1 ? <section key={category.id} className={s.featured}><h2>{category.name}</h2><Cards ctx={ctx} items={items} /></section> : null;
    })}</>,
    "sofreh.menu": ({ section }) => <section className={s.module + " " + enter} data-structure="menu-board"><Rows section={section} /></section>,
    "sofreh.hours": ({ section }) => <aside className={s.hours} aria-label="ساعت کاری"><Icon name="clock" size={27} /><Rows section={section} /></aside>,
  },
};
