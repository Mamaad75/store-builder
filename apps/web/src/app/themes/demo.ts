import { TEMPLATE_DEFINITIONS } from "@store-builder/shared/templates/definitions";
import { storefrontDataSchema } from "@store-builder/shared/templates/storefront-data";

const DEMOS = {
  bazaar: { name: "بازار روز", products: [["لوازم خانه", "ماگ سرامیکی", 285000], ["کالای دیجیتال", "هدفون بی‌سیم", 2450000], ["لوازم روزمره", "کیف پارچه‌ای", 420000]] },
  circuit: { name: "مدار دیجیتال", products: [["لپ‌تاپ", "لپ‌تاپ ۱۴ اینچی", 38900000], ["صوتی", "ایرباد بی‌سیم", 2850000], ["لوازم جانبی", "هاب USB-C", 1590000]], specs: [["نمایشگر", "۱۴ اینچ"], ["حافظه", "۵۱۲ گیگابایت"]] },
  sormeh: { name: "استودیو سُرمه", products: [["عطر", "ادوپرفیوم گل‌های بهاری", 1980000], ["آرایش", "رژ لب مخملی", 460000], ["مراقبت پوست", "کرم مرطوب‌کننده", 680000]] },
  dookht: { name: "خانهٔ دوخت", products: [["کت و بارانی", "بارانی کمربنددار", 3490000], ["بافت", "پلیور یقه‌گرد", 1450000], ["روزمره", "پیراهن کتان", 1690000]] },
  arcade: { name: "آرکید دیجیتال", products: [["گیفت‌کارت", "گیفت‌کارت بازی", 850000], ["اشتراک", "اشتراک یک‌ماهه", 420000], ["دانلود", "بستهٔ محتوای بازی", 295000]], specs: [["نوع محصول", "کد دیجیتال"], ["ریجن", "آمریکا"]] },
  sofreh: { name: "کافه سفره", products: [["قهوه", "لاتهٔ کلاسیک", 125000], ["شیرینی", "کروسان کره‌ای", 95000], ["دانهٔ قهوه", "قهوهٔ تازه‌برشته", 490000]] },
  golkhaneh: { name: "گلخانهٔ بهار", products: [["دسته‌گل", "دسته‌گل رز هلویی", 1290000], ["هدیه", "باکس گل فصل", 1680000], ["گیاه", "گلدان آپارتمانی", 540000]] },
  khaneh: { name: "خانهٔ روشن", products: [["نورپردازی", "آباژور ایستاده", 3850000], ["نشیمن", "مبل تک‌نفره", 8900000], ["دکور", "گلدان سفالی", 620000]] },
} satisfies Record<string, { name: string; products: [string, string, number][]; specs?: [string, string][] }>;

export function loadThemeDemo(key: string) {
  if (!Object.hasOwn(DEMOS, key)) return null;
  const demo: (typeof DEMOS)[keyof typeof DEMOS] = DEMOS[key as keyof typeof DEMOS];
  const isMarket = key === "bazaar";
  const definition = TEMPLATE_DEFINITIONS.findLast((item) => item.key === key);
  if (!definition) return null;

  const image = { key: `stores/demo/${"0".repeat(32)}.webp`, width: 440, height: 440 };
  const marketImages = [1, 2, 3].map((index) => ({ key: `stores/demo/${String(index).repeat(32)}.webp`, width: 480, height: 480 }));
  const marketDescriptions = ["ماگ سنگی لعاب‌دار با دستهٔ راحت، برای چای و قهوهٔ روزانه.", "هدفون دورگوشی با اتصال بی‌سیم و بالشتک‌های نرم.", "کیف پارچه‌ای زیتونی با دسته‌های بلند برای خرید روزمره."];
  const categories = demo.products.map(([name], i) => ({ id: `category-${i + 1}`, slug: `category-${i + 1}`, name }));
  const products = demo.products.map(([, name, price], i) => ({
    id: `product-${i + 1}`,
    slug: `product-${i + 1}`,
    name,
    price,
    stockQuantity: [12, 3, 0][i],
    categoryId: categories[i]!.id,
    image: isMarket ? marketImages[i] : i === 0 ? image : null,
    description: isMarket ? marketDescriptions[i] : "محصول نمونه برای نمایش صفحهٔ جزئیات قالب.",
    specs: isMarket && i === 0 ? [{ label: "جنس", value: "سرامیک لعاب‌دار" }, { label: "گنجایش", value: "۳۲۰ میلی‌لیتر" }]
      : i === 0 && "specs" in demo ? demo.specs.map(([label, value]) => ({ label, value })) : [],
  }));
  const pages = definition.pages.map((page, position) => ({
    ...page,
    position,
    sections: page.sections.map((section) =>
      section.type === "hero" ? { ...section, props: { ...section.props, imageId: "hero-art" } } : section,
    ),
  }));

  return {
    definition,
    data: storefrontDataSchema.parse({
      schemaVersion: 1,
      template: { key, version: definition.version },
      store: {
        name: demo.name,
        direction: definition.settings.direction,
        primaryColor: definition.settings.primaryColor,
        contact: isMarket ? { ...definition.settings.contact, address: "تهران، نشانی نمونهٔ فروشگاه" } : definition.settings.contact,
        social: definition.settings.social,
        ...(isMarket ? { description: "کالاهای کاربردی برای خانه، کار و خرید روزمره." } : {}),
      },
      pages,
      categories,
      products,
      images: { "hero-art": image },
    }),
    mediaUrl: (mediaKey: string) => {
      if (mediaKey === image.key) return `/theme-demos/${key}.webp`;
      const productIndex = isMarket ? marketImages.findIndex((item) => item.key === mediaKey) : -1;
      return productIndex >= 0 ? `/theme-demos/bazaar-product-${productIndex + 1}.webp` : null;
    },
  };
}
