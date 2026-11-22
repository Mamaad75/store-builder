import { arcadeStudioTheme as definition } from "@store-builder/shared/templates/kit/themes";
import { featuredProducts, listProducts, productsInCategory, relatedProducts } from "@store-builder/shared/templates/engine/listing";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { frame, frameProps, Skip, MissingHeading, Tiles, Promos, Highlights, About, Story, Contact, Call, Empty, enter, Brand, Search, Pages, Contacts, Categories, HeroLink, Art, Stock, Price, Specs, productHref, ListingTitle, Sort, Pager, Filter, OrderLinks, Rows } from "../kit/primitives";
import { Icon } from "../kit/icons";
import type { LayoutProps, RenderContext, SectionComponent, TemplateModule } from "../types";
import s from "./studio.module.css";

function Layout({ ctx, children }: LayoutProps) {

  return <div {...frameProps(ctx)} className={`${frame} ${s.root}`} data-storefront-layout="arcade">
    <Skip />
    <header className={s.header}><Brand ctx={ctx} /><Pages ctx={ctx} /><Search ctx={ctx} /></header>
    <div className={s.shell}><aside aria-label="پلتفرم‌های فروشگاه"><p>پلتفرم‌ها</p><Categories ctx={ctx} label="پلتفرم‌ها" /></aside><main id="main" tabIndex={-1} className={s.main}><MissingHeading ctx={ctx} />{children}</main></div>
    <footer className={s.footer}><div><Icon name="headset" /><strong>پشتیبانی</strong><Contacts ctx={ctx} /></div><Pages ctx={ctx} label="پیوندهای پایانی" /></footer>
  </div>;
}

const Hero: SectionComponent<"hero"> = ({ ctx, section }) => (
  <section className={s.hero} data-structure="platform-band"><div className={enter}><h1>{section.props.title}</h1><p>{section.props.subtitle}</p><Categories ctx={ctx} label="انتخاب پلتفرم" /><HeroLink ctx={ctx} text={section.props.buttonText} path={section.props.buttonLink} /></div><div><Art ctx={ctx} imageId={section.props.imageId} priority /></div></section>
);

function Cards({ ctx, items, heading: Title = "h3" }: { ctx: RenderContext; items: StorefrontProduct[]; heading?: "h2" | "h3" }) {
  return <div className={s.cards} data-structure="platform-cards">{items.map((p) => <article key={p.id}><div><Art ctx={ctx} product={p} /></div><section><Title><a href={productHref(ctx,p)}>{p.name}</a></Title><Specs product={p} /><footer><Stock product={p} /><Price product={p} /></footer></section></article>)}</div>;
}

const Grid: SectionComponent<"productGrid"> = ({ ctx, section }) => {
  const result = listProducts(ctx);
  return <section className={s.listing} data-structure="platform-catalog"><ListingTitle result={result} title={section.props.title} /><details><summary>مرتب‌سازی</summary><Sort ctx={ctx} result={result} /></details>{result.items.length ? <Cards ctx={ctx} items={result.items} heading="h2" /> : <Empty />}<Pager ctx={ctx} result={result} /></section>;
};

const Detail: SectionComponent<"productDetail"> = ({ ctx }) => {
  const p = ctx.product;
  if (!p) return null;

  const related = relatedProducts(ctx, p, 6);
  return <>
    <article className={s.detail} data-structure="arcade-purchase"><div><figure><Art ctx={ctx} product={p} alt={p.name} priority /></figure><h1>{p.name}</h1><p>{p.description}</p><Specs product={p} full /></div><aside className={s.purchase}><h2>قیمت و موجودی</h2><Price product={p} /><Stock product={p} /><OrderLinks ctx={ctx} product={p} /></aside></article>
    {related.length > 0 && <section className={s.featured}><h2>کالاهای مشابه</h2><Cards ctx={ctx} items={related} /></section>}
  </>;
};

export const arcadeTemplateV3: TemplateModule = {
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
    "arcade.categories": Tiles, "arcade.promos": Promos, "arcade.highlights": Highlights,
    "arcade.categoryRows": ({ ctx }) => <>{ctx.data.categories.map((category) => {
      const items = productsInCategory(ctx, category.id, 8);
      return items.length > 1 ? <section key={category.id} className={s.featured}><h2>{category.name}</h2><Cards ctx={ctx} items={items} /></section> : null;
    })}</>,
    "arcade.steps": ({ section }) => <section className={s.module + " " + enter} data-structure="activation-steps"><Rows section={section} ordered /></section>,
  },
};
