import { z } from "zod";
import { pageDefinitionSchema, type PageDefinition } from "./section-parse.js";
import { templateSettingsSchema, type TemplateSettingsInput } from "./sections.js";
import { KIT_THEMES } from "./kit/themes.js";

export interface TemplateDefinition {
  key: "appliances" | "coffee" | "fashion" | "general" | "bazaar" | "circuit" | "sormeh" | "dookht" | "arcade" | "sofreh" | "golkhaneh" | "khaneh";
  name: string;
  version: number;
  settings: TemplateSettingsInput;
  pages: PageDefinition[];
}

const emptyContact = { phone: "", email: "", address: "" };
const emptySocial = { instagram: "", telegram: "", whatsapp: "" };

/** Standard five pages; content differs per template. */
function pages(o: {
  heroTitle: string;
  heroSubtitle: string;
  cta: string;
  aboutTitle: string;
  aboutBody: string;
}): PageDefinition[] {
  return [
    {
      type: "HOME", title: "خانه", slug: "home",
      sections: [
        { id: "home-hero", type: "hero", props: { title: o.heroTitle, subtitle: o.heroSubtitle, buttonText: o.cta, buttonLink: "/products", imageId: null } },
        { id: "home-featured", type: "featuredProducts", props: { title: "محصولات ویژه", limit: 4 } },
        { id: "home-about", type: "imageText", props: { title: o.aboutTitle, body: o.aboutBody, imageId: null } },
        { id: "home-cta", type: "callToAction", props: { title: "برای سفارش با ما در تماس باشید", buttonText: "تماس با ما", buttonLink: "/contact" } },
      ],
    },
    {
      type: "PRODUCTS", title: "محصولات", slug: "products",
      sections: [
        { id: "products-filter", type: "categoryFilter", props: {} },
        { id: "products-grid", type: "productGrid", props: { title: "همه محصولات" } },
      ],
    },
    { type: "PRODUCT_DETAIL", title: "جزئیات محصول", slug: "product", sections: [{ id: "detail-main", type: "productDetail", props: {} }] },
    {
      type: "ABOUT", title: "درباره ما", slug: "about",
      sections: [
        { id: "about-text", type: "richText", props: { title: o.aboutTitle, body: o.aboutBody } },
      ],
    },
    {
      type: "CONTACT", title: "تماس با ما", slug: "contact",
      sections: [{ id: "contact-info", type: "contactInfo", props: { title: "تماس با ما", body: "از طریق راه‌های زیر با ما در ارتباط باشید." } }],
    },
  ];
}

type Copy = Parameters<typeof pages>[0];
type KitKey = "bazaar" | "circuit" | "sormeh" | "dookht" | "arcade" | "sofreh" | "golkhaneh" | "khaneh";
type Section = PageDefinition["sections"][number];

/** A theme-specific section with the defaults its theme declares (so the seed can never drift from the definition). */
function extra(key: KitKey, name: string, id: string): Section {
  const type = `${key}.${name}`;
  const def = KIT_THEMES.find((t) => t.key === key)?.sectionDefinitions.find((d) => d.type === type);
  if (!def) throw new Error(`unknown section ${type}`);
  return { id, type, props: { ...def.defaults } } as Section;
}

/**
 * Pages of a kit theme: the standard five pages, with the theme's category tiles and highlights on the home page and its own
 * extra sections where they belong.
 */
function kitPages(key: KitKey, o: Copy, featuredTitle: string, more: { home?: Section[]; products?: Section[]; about?: Section[]; contact?: Section[] } = {}): PageDefinition[] {
  const base = pages(o);
  const [heroS, featured, about, cta] = base[0]!.sections;
  base[0]!.sections = [
    heroS!,
    extra(key, "categories", "home-categories"),
    extra(key, "promos", "home-promos"),
    { ...featured!, props: { ...featured!.props, title: featuredTitle, limit: 10 } } as Section, // a rail: more than one screen
    extra(key, "categoryRows", "home-category-rows"),
    ...(more.home ?? []),
    extra(key, "highlights", "home-highlights"),
    about!,
    cta!,
  ];
  base[1]!.sections = [...base[1]!.sections, ...(more.products ?? [])];
  base[3]!.sections = [...base[3]!.sections, ...(more.about ?? [])];
  base[4]!.sections = [...base[4]!.sections, ...(more.contact ?? [])];
  return base;
}

const settings = (primaryColor: string): TemplateSettingsInput => ({ primaryColor, direction: "rtl", contact: emptyContact, social: emptySocial });

/** The eight business themes (2026-11). Their starter copy matches the business category each one is suggested for. */
const KIT_DEFINITIONS: TemplateDefinition[] = [
  { key: "bazaar", name: "بازار", version: 1, settings: settings("#0e7c66"), pages: kitPages("bazaar", { heroTitle: "هر چه لازم دارید، یک‌جا", heroSubtitle: "محصولات متنوع با ارسال سریع و پرداخت امن", cta: "مشاهده محصولات", aboutTitle: "درباره ما", aboutBody: "فروشگاه ما با هدف ارائه بهترین محصولات راه‌اندازی شده است. این متن را از بخش ویرایش تغییر دهید." }, "پرفروش‌ها") },
  { key: "circuit", name: "مدار", version: 1, settings: settings("#2e5bff"), pages: kitPages("circuit", { heroTitle: "کالای دیجیتال با گارانتی معتبر", heroSubtitle: "مشخصات روشن، موجودی واقعی و مشاوره‌ی خرید", cta: "مشاهده محصولات", aboutTitle: "درباره فروشگاه", aboutBody: "ما کالای دیجیتال اصل را با مشخصات روشن و پشتیبانی عرضه می‌کنیم. این متن را از بخش ویرایش تغییر دهید." }, "تازه‌ها") },
  { key: "sormeh", name: "سرمه", version: 1, settings: settings("#b4466a"), pages: kitPages("sormeh", { heroTitle: "روتین ساده برای پوستی که نفس بکشد", heroSubtitle: "محصولات اصل آرایشی و مراقبتی، انتخاب‌شده برای نوع پوست شما", cta: "مشاهده محصولات", aboutTitle: "درباره ما", aboutBody: "ما محصولات اصل آرایشی و بهداشتی را با مشاوره عرضه می‌کنیم. این متن را از بخش ویرایش تغییر دهید." }, "محبوب این فصل") },
  { key: "dookht", name: "دوخت", version: 1, settings: settings("#2c3e7a"), pages: kitPages("dookht", { heroTitle: "کلکسیون تازه", heroSubtitle: "پوشاک راحت و خوش‌دوخت برای هر روز", cta: "خرید کنید", aboutTitle: "درباره برند ما", aboutBody: "برند ما پوشاک راحت و شیک را برای هر سلیقه‌ای ارائه می‌دهد. این متن را از بخش ویرایش تغییر دهید." }, "تازه رسیده", { products: [extra("dookht", "sizeGuide", "products-size-guide")] }) },
  { key: "arcade", name: "آرکید", version: 1, settings: settings("#6d4dff"), pages: kitPages("arcade", { heroTitle: "اشتراک و گیفت‌کارت، با تحویل سریع", heroSubtitle: "کد و راهنمای فعال‌سازی برای هر محصول", cta: "انتخاب محصول", aboutTitle: "درباره ما", aboutBody: "ما اشتراک‌ها و محصولات دیجیتال را با راهنمای فعال‌سازی و پشتیبانی عرضه می‌کنیم. این متن را از بخش ویرایش تغییر دهید." }, "پرفروش‌ها", { home: [extra("arcade", "steps", "home-steps")] }) },
  { key: "sofreh", name: "سفره", version: 1, settings: settings("#5f7f2e"), pages: kitPages("sofreh", { heroTitle: "طعم خانگی، تازه هر روز", heroSubtitle: "قهوه‌ی تازه‌برشته، شیرینی روز و خوراکی‌های محلی", cta: "مشاهده محصولات", aboutTitle: "داستان ما", aboutBody: "ما با عشق قهوه و مواد غذایی باکیفیت تهیه و عرضه می‌کنیم. این متن را از بخش ویرایش تغییر دهید." }, "خرید برای خانه", { home: [extra("sofreh", "menu", "home-menu"), extra("sofreh", "hours", "home-hours")], contact: [extra("sofreh", "hours", "contact-hours")] }) },
  { key: "golkhaneh", name: "گلخانه", version: 1, settings: settings("#b33a5e"), pages: kitPages("golkhaneh", { heroTitle: "گلی که حرف شما را می‌زند", heroSubtitle: "دسته‌گل تازه و گیاه سالم برای هر مناسبت", cta: "انتخاب گل", aboutTitle: "درباره ما", aboutBody: "ما گل و گیاه تازه را با بسته‌بندی زیبا و ارسال سریع عرضه می‌کنیم. این متن را از بخش ویرایش تغییر دهید." }, "دسته‌گل‌های امروز", { home: [extra("golkhaneh", "delivery", "home-delivery")] }) },
  { key: "khaneh", name: "خانه", version: 1, settings: settings("#0f6e74"), pages: kitPages("khaneh", { heroTitle: "لوازم خانگی مطمئن برای خانهٔ شما", heroSubtitle: "کالاهای اصل با گارانتی و مشخصات روشن", cta: "مشاهده محصولات", aboutTitle: "درباره فروشگاه", aboutBody: "ما لوازم خانگی معتبر را با راهنمایی روشن و پشتیبانی عرضه می‌کنیم. این متن را از بخش ویرایش تغییر دهید." }, "پرفروش‌ها") },
];

/** Every seeded template: the eight business themes, then the MVP themes. Existing versions are immutable; add new versions instead. */
export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  ...KIT_DEFINITIONS,
  {
    key: "coffee",
    name: "قهوه و مواد غذایی",
    version: 1,
    settings: { primaryColor: "#8b5a2b", direction: "rtl", contact: emptyContact, social: emptySocial },
    pages: pages({
      heroTitle: "قهوه تازه، هر روز",
      heroSubtitle: "دانه‌های برشته‌شده و محصولات خوش‌طعم برای شروع بهتر روز شما",
      cta: "مشاهده محصولات",
      aboutTitle: "داستان ما",
      aboutBody: "ما با عشق قهوه و مواد غذایی باکیفیت تهیه و عرضه می‌کنیم. این متن را از بخش ویرایش تغییر دهید.",
    }),
  },
  {
    key: "fashion",
    name: "پوشاک",
    version: 1,
    settings: { primaryColor: "#111827", direction: "rtl", contact: emptyContact, social: emptySocial },
    pages: pages({
      heroTitle: "استایل خودتان را پیدا کنید",
      heroSubtitle: "جدیدترین مدل‌های پوشاک با کیفیت و قیمت مناسب",
      cta: "خرید کنید",
      aboutTitle: "درباره برند ما",
      aboutBody: "برند ما پوشاک راحت و شیک را برای هر سلیقه‌ای ارائه می‌دهد. این متن را از بخش ویرایش تغییر دهید.",
    }),
  },
  {
    key: "appliances",
    name: "لوازم خانگی",
    version: 1,
    settings: { primaryColor: "#1664c0", direction: "rtl", contact: emptyContact, social: emptySocial },
    pages: pages({
      heroTitle: "لوازم خانگی مطمئن برای خانهٔ شما",
      heroSubtitle: "کالاهای اصل با گارانتی و مشخصات روشن",
      cta: "مشاهده محصولات",
      aboutTitle: "درباره فروشگاه",
      aboutBody: "ما لوازم خانگی معتبر را با راهنمایی روشن و پشتیبانی عرضه می‌کنیم. این متن را از بخش ویرایش تغییر دهید.",
    }),
  },
  {
    key: "general",
    name: "فروشگاه عمومی",
    version: 1,
    settings: { primaryColor: "#2563eb", direction: "rtl", contact: emptyContact, social: emptySocial },
    pages: pages({
      heroTitle: "به فروشگاه ما خوش آمدید",
      heroSubtitle: "محصولات متنوع با کیفیت مطمئن",
      cta: "مشاهده محصولات",
      aboutTitle: "درباره ما",
      aboutBody: "فروشگاه ما با هدف ارائه بهترین محصولات راه‌اندازی شده است. این متن را از بخش ویرایش تغییر دهید.",
    }),
  },
];

export const templateDefinitionSchema = z.object({
  settings: templateSettingsSchema,
  pages: z.array(pageDefinitionSchema).length(5),
});
