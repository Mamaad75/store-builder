import { storyImage } from "../kit/story-image";
import { sectionImage, listUrl } from "@store-builder/shared/templates/engine/listing";
import { parseLabelLines } from "@store-builder/shared/templates/engine/lines";
import { buildContactLinks } from "@store-builder/shared/templates/engine/links";
import { Icon } from "../kit/icons";
import { ProductImage } from "./catalog";
import type { ExtraSectionComponent, SectionComponent } from "../types";
import s from "./market.module.css";

export const Hero: SectionComponent<"hero"> = ({ section, ctx }) => {
  const { title, subtitle, buttonText, buttonLink, imageId } = section.props;
  const art = sectionImage(ctx, imageId);
  return <section className={s.promotion} data-bazaar-region="compact-promotion" aria-labelledby={section.id}>
    <div>
      <h1 id={section.id}>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {buttonText && <a className={s.button} href={ctx.href(buttonLink)}>{buttonText} <Icon name="chevron" size={17} /></a>}
    </div>
    {art && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={art.url} width={art.width} height={art.height} alt="" fetchPriority="high" decoding="async" />
    )}
  </section>;
};

export const Categories: ExtraSectionComponent = ({ section, ctx }) => {
  if (!ctx.data.categories.length) return null;
  const title = typeof section.props.title === "string" ? section.props.title : "";
  return <section className={s.panel} aria-label={title || "خرید بر اساس دسته"}>
    {title && <h2>{title}</h2>}
    <div className={s.scroll} role="region" aria-label="فهرست افقی دسته‌ها" tabIndex={0}>
      <ul className={s.categories} data-bazaar-region="category-circles">
        {ctx.data.categories.map((category) => {
          const product = ctx.data.products.find((item) => item.categoryId === category.id && item.image);
          return <li key={category.id}><a href={listUrl(ctx, { category: category.slug })}>
            <span className={s.categoryImage}>{product ? <ProductImage ctx={ctx} product={product} /> : <Icon name="grid" />}</span>
            <span>{category.name}</span>
          </a></li>;
        })}
      </ul>
    </div>
  </section>;
};

export const Promos: ExtraSectionComponent = ({ section, ctx }) => {
  const { title, items } = section.props;
  if (typeof items !== "string") return null;
  const tiles = items.split("\n").map((line) => line.split("|").map((part) => part.trim())).filter(([name]) => name).slice(0, 4);
  if (!tiles.length) return null;
  return <section aria-label={typeof title === "string" && title ? title : "مرور محصولات"} className={s.promoGrid}>
    {tiles.map(([name, body, categoryName], index) => {
      const category = ctx.data.categories.find((item) => item.name === categoryName);
      return <a key={index} href={listUrl(ctx, { category: category?.slug })}>
        <div><h2>{name}</h2>{body && <p>{body}</p>}</div><Icon name="chevron" size={20} />
      </a>;
    })}
  </section>;
};

export const Highlights: ExtraSectionComponent = ({ section }) => {
  const { title, items, note } = section.props;
  const rows = typeof items === "string" ? parseLabelLines(items) : [];
  if (!rows.length) return null;
  return <section className={s.panel} aria-label={typeof title === "string" && title ? title : "خدمات فروشگاه"}>
    {typeof title === "string" && title && <h2>{title}</h2>}
    <ul className={s.services}>{rows.map((row, index) => <li key={index}><Icon name="check" size={20} /><span>{row.label && <strong>{row.label} </strong>}{row.value}</span></li>)}</ul>
    {typeof note === "string" && note && <p>{note}</p>}
  </section>;
};

export const RichText: SectionComponent<"richText"> = ({ ctx, section }) => {
  const Title = ctx.page.type === "ABOUT" && ctx.page.sections.find((item) => item.type === "richText")?.id === section.id ? "h1" : "h2";
  return <section className={s.panel} aria-labelledby={section.id}><Title id={section.id}>{section.props.title}</Title><p className={s.prose}>{section.props.body}</p></section>;
};

export const ImageText: SectionComponent<"imageText"> = ({ ctx, section }) => {
  const art = storyImage({ ctx, section });
  return <section className={`${s.panel} ${s.story}`} aria-labelledby={section.id}>
    <div><h2 id={section.id}>{section.props.title}</h2><p className={s.prose}>{section.props.body}</p></div>
    {art && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={art.url} width={art.width} height={art.height} alt="" loading="lazy" decoding="async" />
    )}
  </section>;
};

export const ContactInfo: SectionComponent<"contactInfo"> = ({ ctx, section }) => {
  const Title = ctx.page.type === "CONTACT" ? "h1" : "h2";
  const links = buildContactLinks(ctx.data.store.contact, ctx.data.store.social);
  return <section className={s.panel} aria-labelledby={section.id}>
    <Title id={section.id}>{section.props.title}</Title><p className={s.prose}>{section.props.body}</p>
    <ul className={s.contacts}>{links.map((link) => <li key={link.kind}>{link.href ? <a href={link.href}>{link.label} <bdi>{link.value}</bdi></a> : `${link.label} · ${link.value}`}</li>)}</ul>
  </section>;
};

export const CallToAction: SectionComponent<"callToAction"> = ({ ctx, section }) => (
  <section className={`${s.panel} ${s.sectionHead}`} aria-labelledby={section.id}>
    <h2 id={section.id}>{section.props.title}</h2>
    <a className={s.button} href={ctx.href(section.props.buttonLink)}>{section.props.buttonText}</a>
  </section>
);
