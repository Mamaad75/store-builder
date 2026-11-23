import { formatNumberFa } from "@store-builder/shared/lib/money";
import { listUrl, sectionImage } from "@store-builder/shared/templates/engine/listing";
import { KIT_THEMES_V4 } from "@store-builder/shared/templates/kit/themes";
import { productPriceLabel, type StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { Art, productHref, Specs } from "./kit/primitives";
import { Icon } from "./kit/icons";
import type { ExtraSectionComponent, RenderContext, SectionComponent, TemplateModule } from "./types";
import s from "./landing.module.css";

type BlockProps = Parameters<ExtraSectionComponent>[0];

function categoryByName(ctx: RenderContext, value: unknown) {
  return value ? ctx.data.categories.find((item) => item.slug === value || item.name === value) : undefined;
}

function categoryArt(ctx: RenderContext, id: string) {
  return ctx.data.products.find((product) => product.categoryId === id && product.image);
}

const Discovery: ExtraSectionComponent = ({ section, ctx }) => {
  const categories = ctx.data.categories.slice(0, Number(section.props.limit));
  if (!categories.length) return null;
  return (
    <section className={s.discovery} aria-labelledby={`${section.id}-heading`} data-landing-section="discovery">
      <h2 id={`${section.id}-heading`}>{String(section.props.title)}</h2>
      <ul>{categories.map((item, i) => (
        <li key={item.id}>
          <a href={listUrl(ctx, { category: item.slug })}>
            <span className={s.categoryArt}><Art ctx={ctx} product={categoryArt(ctx, item.id)} /></span>
            <span className={s.categoryName}>{item.name}<Icon name={i === 0 ? "chevron" : "grid"} size={15} /></span>
          </a>
        </li>
      ))}</ul>
    </section>
  );
};

const Campaign: ExtraSectionComponent = ({ section, ctx }) => {
  const { title, body, category, action, imageId } = section.props;
  const pick = categoryByName(ctx, category);
  const image = sectionImage(ctx, typeof imageId === "string" ? imageId : null);
  const product = pick ? categoryArt(ctx, pick.id) : ctx.data.products.findLast((item) => item.image);
  return (
    <section className={s.campaign} aria-labelledby={`${section.id}-heading`} data-landing-section="campaign">
      <div className={s.campaignCopy}>
        <h2 id={`${section.id}-heading`}>{String(title)}</h2>
        {Boolean(body) && <p>{String(body)}</p>}
        {Boolean(action) && <a className={s.button} href={listUrl(ctx, { category: pick?.slug })}>{String(action)} <Icon name="chevron" size={17} /></a>}
      </div>
      {(image || product) && <figure className={s.campaignArt}><Art ctx={ctx} imageId={image ? String(imageId) : null} product={image ? undefined : product} /></figure>}
    </section>
  );
};

function selectProducts({ section, ctx }: BlockProps) {
  const category = categoryByName(ctx, section.props.category);
  if (section.props.category && !category) return [];
  const limit = Number(section.props.limit);
  const result: StorefrontProduct[] = [];
  for (const item of ctx.data.products) {
    if (category && item.categoryId !== category.id) continue;
    if (section.props.availability === 1 && item.stockQuantity <= 0) continue;
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

const Shelf: ExtraSectionComponent = ({ section, ctx }) => {
  const items = selectProducts({ section, ctx });
  if (!items.length) return null;
  const title = String(section.props.title);
  const category = categoryByName(ctx, section.props.category);
  const inStock = section.props.availability === 1;
  return (
    <section className={s.shelf} aria-labelledby={`${section.id}-heading`} data-landing-section="shelf" data-available={inStock}>
      <div className={s.shelfHead}>
        <h2 id={`${section.id}-heading`}>{title}</h2>
        <a href={listUrl(ctx, { category: category?.slug, sort: inStock ? "available" : undefined })}>دیدن فهرست <Icon name="chevron" size={17} /></a>
      </div>
      <ul className={s.shelfTrack} tabIndex={0} aria-label={title}>
        {items.map((item) => (
          <li key={item.id} className={s.product}>
            <a className={s.productLink} href={productHref(ctx, item)}>
              <span className={s.productArt}><Art ctx={ctx} product={item} /></span>
              <div className={s.productCopy}>
                <h3>{item.name}</h3>
                {(ctx.data.template.key === "circuit" || ctx.data.template.key === "khaneh" || ctx.data.template.key === "arcade") && <Specs product={item} />}
                <strong>{productPriceLabel(item)}</strong>
                {item.stockQuantity <= 0 && <span>ناموجود</span>}
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
};

const CategoryShelves: ExtraSectionComponent = ({ section, ctx }) => {
  const maxCategories = Number(section.props.categories);
  const limit = Number(section.props.limit);
  const groups = new Map<string, number>();
  for (const product of ctx.data.products) {
    if (product.categoryId) groups.set(product.categoryId, (groups.get(product.categoryId) ?? 0) + 1);
  }
  const categories = ctx.data.categories.filter((category) => (groups.get(category.id) ?? 0) > 1).slice(0, maxCategories);
  return <>{categories.map((category, index) => (
    <Shelf key={category.id} ctx={ctx} section={{ ...section, id: `${section.id}-${index}`, props: {
      title: category.name, category: category.slug, limit, availability: 0,
    } }} />
  ))}</>;
};


const Guide: ExtraSectionComponent = ({ section }) => {
  const items = String(section.props.items).split("\n").slice(0, 8).flatMap((line) => {
    const separator = line.indexOf("|");
    return separator > 0 ? [{ title: line.slice(0, separator).trim(), body: line.slice(separator + 1).trim() }] : [];
  }).filter((item) => item.title && item.body);
  if (!items.length) return null;
  return (
    <section className={s.guide} aria-labelledby={`${section.id}-heading`} data-landing-section="guide">
      <div className={s.guideTitle}><Icon name="info" size={26} /><h2 id={`${section.id}-heading`}>{String(section.props.title)}</h2></div>
      <div className={s.guideItems}>{items.map((item, i) => <details key={i}><summary>{item.title}</summary><p>{item.body}</p></details>)}</div>
    </section>
  );
};

const Spotlight: ExtraSectionComponent = ({ section, ctx }) => {
  const key = ctx.data.template.key;
  const limit = Number(section.props.limit);
  const compare = key === "circuit" || key === "khaneh";
  const categories = key === "bazaar" || key === "arcade" || key === "golkhaneh";
  const cards = categories
    ? ctx.data.categories.slice(0, limit).map((category) => ({
      id: category.id, title: category.name, href: listUrl(ctx, { category: category.slug }), photo: categoryArt(ctx, category.id),
    }))
    : ctx.data.products.slice(0, limit).map((product) => ({
      id: product.id, title: product.name, href: productHref(ctx, product), photo: product,
    }));
  if (!cards.length) return null;
  return (
    <section className={s.spotlight} aria-labelledby={`${section.id}-heading`} data-landing-section="spotlight">
      <div className={s.spotlightHead}>
        <h2 id={`${section.id}-heading`}>{String(section.props.title)}</h2>
        {Boolean(section.props.body) && <p>{String(section.props.body)}</p>}
      </div>
      <ul className={s.spotlightGrid}>
        {cards.map((card) => (
          <li key={card.id}>
            <a className={s.spotlightLink} href={card.href}>
              <figure><Art ctx={ctx} product={card.photo} /></figure>
              <div><h3>{card.title}</h3>{compare && card.photo && <Specs product={card.photo} />}</div>
              <Icon name="chevron" size={18} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
};


const MarketplaceHero: SectionComponent<"hero"> = ({ section, ctx }) => {
  const { title, subtitle, buttonText, buttonLink, imageId } = section.props;
  const groups = ctx.data.categories.slice(0, 4);
  return (
    <section className={s.marketLead} aria-labelledby={`${section.id}-heading`}>
      <div className={s.marketFeature}>
        <div>
          <h1 id={`${section.id}-heading`}>{title}</h1>
          <p>{subtitle}</p>
          {buttonText && <a href={ctx.href(buttonLink)} className={s.button}>{buttonText} <Icon name="chevron" size={18} /></a>}
        </div>
        <figure><Art ctx={ctx} imageId={imageId} priority fallbackProduct /></figure>
      </div>
      <nav className={s.marketNav} aria-label="میان‌بر دسته‌های بازار">
        {groups.length ? groups.map((group) => <a key={group.id} href={listUrl(ctx, { category: group.slug })}>
          <span>{group.name}</span><Icon name="chevron" size={18} />
        </a>) : <a href={ctx.href("/products")}>همهٔ محصولات</a>}
      </nav>
    </section>
  );
};

const TechHero: SectionComponent<"hero"> = ({ section, ctx }) => {
  const { title, subtitle, buttonText, buttonLink, imageId } = section.props;
  const pick = ctx.data.products.find((item) => item.stockQuantity > 0 && item.specs.length > 0);
  return (
    <section className={s.techLead} aria-labelledby={`${section.id}-heading`}>
      <div className={s.techCopy}>
        <h1 id={`${section.id}-heading`}>{title}</h1>
        <p>{subtitle}</p>
        {buttonText && <a href={ctx.href(buttonLink)} className={s.button}>{buttonText} <Icon name="chevron" size={18} /></a>}
        <span>{formatNumberFa(ctx.data.categories.length)} دستهٔ تخصصی</span>
      </div>
      <figure><Art ctx={ctx} imageId={imageId} priority fallbackProduct /></figure>
      {pick && <aside className={s.techSpec} aria-label="مشخصات کالای منتخب">
        <h2><a href={productHref(ctx, pick)}>{pick.name}</a></h2><Specs product={pick} /><strong>{productPriceLabel(pick)}</strong>
      </aside>}
    </section>
  );
};

export function editorialLanding(base: TemplateModule): TemplateModule {
  const definition = KIT_THEMES_V4.find((theme) => theme.key === base.key);
  if (!definition) throw new Error(`Missing landing definition: ${base.key}`);
  const hero = base.key === "bazaar" ? MarketplaceHero : base.key === "circuit" ? TechHero : base.sections.hero;
  return {
    ...base, version: definition.version, definition, editor: definition.editor,
    Layout: ({ ctx, children }) => <div className={s.edition} data-landing-theme={base.key} data-landing-version="4"><base.Layout ctx={ctx}>{children}</base.Layout></div>,
    sections: { ...base.sections, hero },
    extraSections: {
      ...base.extraSections,
      [`${base.key}.categoryRows`]: CategoryShelves,
      [`${base.key}.discovery`]: Discovery,
      [`${base.key}.campaign`]: Campaign,
      [`${base.key}.shelf`]: Shelf,
      [`${base.key}.guide`]: Guide,
      [`${base.key}.spotlight`]: Spotlight,
    },
  };
}
