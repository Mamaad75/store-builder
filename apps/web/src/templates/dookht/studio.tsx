import { dookhtStudioTheme as definition } from "@store-builder/shared/templates/kit/themes";
import { featuredProducts, listProducts, productsInCategory, relatedProducts } from "@store-builder/shared/templates/engine/listing";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { frame, frameProps, Skip, MissingHeading, Tiles, Promos, Highlights, About, Story, Contact, Call, Empty, enter, Brand, SiteSearch, Pages, Contacts, HeroLink, Art, Stock, Price, Specs, productHref, ListingTitle, Sort, Pager, Filter, OrderLinks, SizeGuide } from "../kit/primitives";
import type { LayoutProps, RenderContext, SectionComponent, TemplateModule } from "../types";
import s from "./studio.module.css";

function Layout({ ctx, children }: LayoutProps) {

  return <div {...frameProps(ctx)} className={`${frame} ${s.root}`} data-storefront-layout="dookht">
    <Skip />
    <header className={s.header}><Brand ctx={ctx} /><Pages ctx={ctx} /><SiteSearch ctx={ctx} /></header>
    <main id="main" tabIndex={-1} className={s.main}><MissingHeading ctx={ctx} />{children}</main>
    <footer className={s.footer}><Brand ctx={ctx} /><Pages ctx={ctx} label="پیوندهای پایانی" /><Contacts ctx={ctx} /></footer>
  </div>;
}

const Hero: SectionComponent<"hero"> = ({ ctx, section }) => (
  <section className={s.hero} data-structure="fashion-cover"><figure><Art ctx={ctx} imageId={section.props.imageId} priority /></figure><header className={enter}><h1>{section.props.title}</h1><p>{section.props.subtitle}</p><HeroLink ctx={ctx} text={section.props.buttonText} path={section.props.buttonLink} /></header></section>
);

function Cards({ ctx, items, heading: Title = "h3" }: { ctx: RenderContext; items: StorefrontProduct[]; heading?: "h2" | "h3" }) {
  return <div className={s.cards} data-structure="editorial-mosaic">{items.map((p) => <figure key={p.id}><div><Art ctx={ctx} product={p} /></div><figcaption><Title><a href={productHref(ctx,p)}>{p.name}</a></Title><Price product={p} /><Stock product={p} /><Specs product={p} /></figcaption></figure>)}</div>;
}

const Grid: SectionComponent<"productGrid"> = ({ ctx, section }) => {
  const result = listProducts(ctx);
  return <section className={s.listing} data-structure="fashion-editorial"><header><ListingTitle result={result} title={section.props.title} /></header>{result.items.length ? <Cards ctx={ctx} items={result.items} heading="h2" /> : <Empty />}<div><Sort ctx={ctx} result={result} /><Pager ctx={ctx} result={result} /></div></section>;
};

const Detail: SectionComponent<"productDetail"> = ({ ctx }) => {
  const p = ctx.product;
  if (!p) return null;
  const side = ctx.data.pages.find((page) => page.type === "PRODUCTS")?.sections.find((section) => section.type === "dookht.sizeGuide");
  const guide = side as Parameters<typeof SizeGuide>[0]["section"] | undefined;
  const related = relatedProducts(ctx, p, 6);
  return <>
    <article className={s.detail} data-structure="fashion-vertical-gallery"><figure><Art ctx={ctx} product={p} alt={p.name} priority /></figure><aside><h1>{p.name}</h1><Price product={p} /><Stock product={p} /><p>{p.description}</p><OrderLinks ctx={ctx} product={p} />{guide && <SizeGuide section={guide} />}<Specs product={p} full /></aside></article>
    {related.length > 0 && <section className={s.featured}><h2>کالاهای مشابه</h2><Cards ctx={ctx} items={related} /></section>}
  </>;
};

export const dookhtTemplateV3: TemplateModule = {
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
    "dookht.categories": Tiles, "dookht.promos": Promos, "dookht.highlights": Highlights,
    "dookht.categoryRows": ({ ctx }) => <>{ctx.data.categories.map((category) => {
      const items = productsInCategory(ctx, category.id, 8);
      return items.length > 1 ? <section key={category.id} className={s.featured}><h2>{category.name}</h2><Cards ctx={ctx} items={items} /></section> : null;
    })}</>,
    "dookht.sizeGuide": ({ section }) => <section className={s.module}><SizeGuide section={section} /></section>,
  },
};
