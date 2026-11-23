import { khanehStudioTheme as definition } from "@store-builder/shared/templates/kit/themes";
import { featuredProducts, listProducts, productsInCategory, relatedProducts } from "@store-builder/shared/templates/engine/listing";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { frame, frameProps, Skip, MissingHeading, Tiles, Promos, Highlights, About, Story, Contact, Call, Empty, enter, Brand, Search, Pages, Contacts, Categories, HeroLink, Art, Stock, Price, Variants, Specs, productHref, ListingTitle, Sort, Pager, Filter, OrderLinks } from "../kit/primitives";
import { Icon } from "../kit/icons";
import type { LayoutProps, RenderContext, SectionComponent, TemplateModule } from "../types";
import s from "./studio.module.css";
import ShopNav from "../commerce/ShopNav";

function Layout({ ctx, children }: LayoutProps) {

  return <div {...frameProps(ctx)} className={`${frame} ${s.root}`} data-storefront-layout="khaneh">
    <Skip />
    <header className={s.header}><div><Brand ctx={ctx} /><Search ctx={ctx} /><ShopNav ctx={ctx} /></div><section aria-label="منوی فروشگاه"><details className={s.mega}><summary><Icon name="grid" /> دسته‌بندی‌ها</summary><Categories ctx={ctx} /></details><Pages ctx={ctx} /></section></header>
    <main id="main" tabIndex={-1} className={s.main}><MissingHeading ctx={ctx} />{children}</main>
    <footer className={s.footer}><div><Brand ctx={ctx} /><p>{ctx.data.store.description}</p></div><Pages ctx={ctx} label="پیوندهای پایانی" /><Categories ctx={ctx} label="دسته‌ها در پاورقی" /><Contacts ctx={ctx} /></footer>
  </div>;
}

const Hero: SectionComponent<"hero"> = ({ ctx, section }) => (
  <section className={s.hero} data-structure="homeware-dual-promotion">
    <div className={enter}><h1>{section.props.title}</h1><p>{section.props.subtitle}</p><HeroLink ctx={ctx} text={section.props.buttonText} path={section.props.buttonLink} /></div>
    <figure><Art ctx={ctx} imageId={section.props.imageId} priority fallbackProduct /><figcaption><a href={ctx.href("/products")}>مرور کاتالوگ خانه</a></figcaption></figure>
  </section>
);

function Cards({ ctx, items, heading: Title = "h3" }: { ctx: RenderContext; items: StorefrontProduct[]; heading?: "h2" | "h3" }) {
  return <div className={s.cards} data-structure="homeware-grid">{items.map((p) => <article key={p.id}><figure><Art ctx={ctx} product={p} /></figure><Title><a href={productHref(ctx,p)}>{p.name}</a></Title><div className={s.comparison}><Specs product={p} /></div><footer><Stock product={p} /><Price product={p} /></footer></article>)}</div>;
}

const Grid: SectionComponent<"productGrid"> = ({ ctx, section }) => {
  const result = listProducts(ctx);
  return <section className={s.listing} data-structure="homeware-sidebar"><header><ListingTitle result={result} title={section.props.title} /></header><div className={s.columns}>{ctx.page.sections.some((item) => item.type === "categoryFilter") && <aside aria-label="فیلترهای کاتالوگ"><div className={s.desktopFilter}><h2>دسته‌بندی‌ها</h2><Filter ctx={ctx} /></div><details className={s.mobileFilter}><summary>فیلتر دسته‌بندی</summary><Filter ctx={ctx} /></details></aside>}<div><Sort ctx={ctx} result={result} />{result.items.length ? <Cards ctx={ctx} items={result.items} heading="h2" /> : <Empty />}<Pager ctx={ctx} result={result} /></div></div></section>;
};

const Detail: SectionComponent<"productDetail"> = ({ ctx }) => {
  const p = ctx.product;
  if (!p) return null;

  const related = relatedProducts(ctx, p, 6);
  return <>
    <article className={s.detail} data-structure="homeware-trust"><header><h1>{p.name}</h1><div className={s.trust}><Icon name="shield" /><a href={ctx.href("/contact")}>شرایط گارانتی و ارسال</a></div></header><div><figure><Art ctx={ctx} product={p} alt={p.name} priority /></figure><section><p>{p.description}</p><div className={s.purchase}><Price product={p} /><Stock product={p} /><Variants product={p} /><OrderLinks ctx={ctx} product={p} /></div><Specs product={p} full /></section></div></article>
    {related.length > 0 && <section className={s.featured}><h2>کالاهای مشابه</h2><Cards ctx={ctx} items={related} /></section>}
  </>;
};

export const khanehTemplateV3: TemplateModule = {
  definition, key: definition.key, version: definition.version, name: definition.meta.name, editor: definition.editor, Layout,
  sections: {
    hero: Hero, productGrid: Grid, productDetail: Detail,
    featuredProducts: ({ ctx, section }) => {
      const items = featuredProducts(ctx, section.props.limit);
      return <section className={s.featured}><h2>{section.props.title}</h2>{items.length ? <Cards ctx={ctx} items={items} /> : <Empty />}</section>;
    },
    categoryFilter: () => null, richText: About, imageText: Story, contactInfo: Contact, callToAction: Call,
  },
  extraSections: {
    "khaneh.categories": Tiles, "khaneh.promos": Promos, "khaneh.highlights": Highlights,
    "khaneh.categoryRows": ({ ctx }) => <>{ctx.data.categories.map((category) => {
      const items = productsInCategory(ctx, category.id, 8);
      return items.length > 1 ? <section key={category.id} className={s.featured}><h2>{category.name}</h2><Cards ctx={ctx} items={items} /></section> : null;
    })}</>,

  },
};
