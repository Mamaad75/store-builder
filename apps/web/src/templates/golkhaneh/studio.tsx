import { golkhanehStudioTheme as definition } from "@store-builder/shared/templates/kit/themes";
import { featuredProducts, listProducts, productsInCategory, relatedProducts, listUrl } from "@store-builder/shared/templates/engine/listing";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { frame, frameProps, Skip, MissingHeading, Promos, Highlights, About, Story, Contact, Call, Empty, enter, Brand, SiteSearch, Pages, Contacts, Categories, HeroLink, Art, Stock, Price, Variants, Specs, productHref, ListingTitle, Sort, Pager, Filter, OrderLinks } from "../kit/primitives";
import { Icon } from "../kit/icons";
import type { LayoutProps, RenderContext, SectionComponent, TemplateModule } from "../types";
import s from "./studio.module.css";
import ShopNav from "../commerce/ShopNav";
import EnamadSeal from "../common/EnamadSeal";

function Layout({ ctx, children }: LayoutProps) {
  const delivery = ctx.data.pages.find((page) => page.type === "HOME")?.sections.find((section) => section.type === "golkhaneh.delivery");
  const badge = delivery && "badge" in delivery.props ? String(delivery.props.badge ?? "") : "";
  return <div {...frameProps(ctx)} className={`${frame} ${s.root}`} data-storefront-layout="golkhaneh">
    <Skip />
    <header className={s.header}>{badge && <p className={s.delivery}>{badge}</p>}<div><Brand ctx={ctx} /><SiteSearch ctx={ctx} /><ShopNav ctx={ctx} /></div><Pages ctx={ctx} /></header>
    <main id="main" tabIndex={-1} className={s.main}><MissingHeading ctx={ctx} />{children}</main>
    <footer className={s.footer}><div><Icon name="leaf" size={28} /><Brand ctx={ctx} /></div><Contacts ctx={ctx} /><Categories ctx={ctx} label="مناسبت‌ها در پاورقی" /><EnamadSeal enamad={ctx.data.store.enamad} /></footer>
  </div>;
}

const Hero: SectionComponent<"hero"> = ({ ctx, section }) => (
  <section className={s.hero} data-structure="occasion-carousel"><div className={enter}><h1>{section.props.title}</h1><p>{section.props.subtitle}</p><HeroLink ctx={ctx} text={section.props.buttonText} path={section.props.buttonLink} /></div><div className={s.slider} tabIndex={0} role="region" aria-label="تصاویر گل‌ها"><figure><Art ctx={ctx} imageId={section.props.imageId} priority fallbackProduct /></figure>{ctx.data.products.filter((p) => p.image).slice(0,2).map((p) => <figure key={p.id}><Art ctx={ctx} product={p} alt={p.name} /></figure>)}</div></section>
);

function Cards({ ctx, items, heading: Title = "h3" }: { ctx: RenderContext; items: StorefrontProduct[]; heading?: "h2" | "h3" }) {
  return <ul className={s.cards} data-structure="arched-occasion-pairs">{items.map((p) => <li key={p.id}><article><figure><Art ctx={ctx} product={p} /></figure><div><Title><a href={productHref(ctx,p)}>{p.name}</a></Title><Stock product={p} /><Price product={p} /><Specs product={p} /></div></article></li>)}</ul>;
}

const Grid: SectionComponent<"productGrid"> = ({ ctx, section }) => {
  const result = listProducts(ctx);
  return <section className={s.listing} data-structure="occasion-catalog"><header><Icon name="leaf" /><ListingTitle result={result} title={section.props.title} /><Sort ctx={ctx} result={result} /></header>{result.items.length ? <Cards ctx={ctx} items={result.items} heading="h2" /> : <Empty />}<Pager ctx={ctx} result={result} /></section>;
};

const Detail: SectionComponent<"productDetail"> = ({ ctx }) => {
  const p = ctx.product;
  if (!p) return null;

  const related = relatedProducts(ctx, p, 6);
  return <>
    <article className={s.detail} data-structure="gift-product"><figure><Art ctx={ctx} product={p} alt={p.name} priority /></figure><div><h1>{p.name}</h1><p>{p.description}</p><fieldset><legend>مرور بر اساس مناسبت</legend><Categories ctx={ctx} label="مناسبت‌های دیگر" /></fieldset><details><summary>پیام همراه گل</summary><p>برای هماهنگی کارت پیام، متن دلخواه را هنگام تماس یا سفارش به فروشگاه بگویید.</p></details><div className={s.purchase}><Price product={p} /><Stock product={p} /><Variants product={p} /><OrderLinks ctx={ctx} product={p} /></div><Specs product={p} full /></div></article>
    {related.length > 0 && <section className={s.featured}><h2>کالاهای مشابه</h2><Cards ctx={ctx} items={related} /></section>}
  </>;
};

export const golkhanehTemplateV3: TemplateModule = {
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
    "golkhaneh.categories": ({ ctx, section }) => <section className={s.occasions} data-structure="occasion-tiles"><h2>{String(section.props.title || "برای چه مناسبتی؟")}</h2><ul>{ctx.data.categories.map((category) => <li key={category.id}><a href={listUrl(ctx, { category: category.slug })}><Icon name="gift" size={25} />{category.name}</a></li>)}</ul></section>, "golkhaneh.promos": Promos, "golkhaneh.highlights": Highlights,
    "golkhaneh.categoryRows": ({ ctx }) => <>{ctx.data.categories.map((category) => {
      const items = productsInCategory(ctx, category.id, 8);
      return items.length > 1 ? <section key={category.id} className={s.featured}><h2>{category.name}</h2><Cards ctx={ctx} items={items} /></section> : null;
    })}</>,
    "golkhaneh.delivery": ({ section }) => <aside className={s.module} aria-label="زمان ارسال"><h2>{String(section.props.title)}</h2><p>{String(section.props.body)}</p></aside>,
  },
};
