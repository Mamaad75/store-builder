import { z } from "zod";
import { pageDefinitionSchema, type PageDefinition } from "./section-parse";
import { templateSettingsSchema, type TemplateSettingsInput } from "./sections";

export interface TemplateDefinition {
  key: "appliances" | "coffee" | "fashion" | "general";
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

/** The three MVP templates. Existing versions are immutable once stores use them; add new versions instead. */
export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
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
