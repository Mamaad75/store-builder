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

const descriptions = {
  bazaar: ["ماگ سنگی لعاب‌دار با دستهٔ راحت، برای چای و قهوهٔ روزانه.", "هدفون دورگوشی با اتصال بی‌سیم و بالشتک‌های نرم.", "کیف پارچه‌ای زیتونی برای خرید روزمره."],
  circuit: ["لپ‌تاپ سبک با بدنهٔ آلومینیومی برای کار و مطالعه.", "ایرباد سبک با کیس شارژ جمع‌وجور.", "هاب چنددرگاهی برای اتصال نمایشگر و وسایل جانبی."],
  sormeh: ["رایحه‌ای لطیف با نت‌های گل سفید و چوب صندل.", "رنگ رز ملایم با پوشش مات و بافت سبک.", "کرم سبک برای رطوبت‌رسانی روزانه."],
  dookht: ["بارانی کرم با کمربند قابل تنظیم و برش آزاد.", "پلیور نرم با یقهٔ گرد و بافت ریز.", "پیراهن سبک کتانی برای پوشش روزمره."],
  arcade: ["اعتبار خرید برای حساب سازگار با ریجن کارت.", "دسترسی یک‌ماهه برای پلتفرم درج‌شده در مشخصات.", "بستهٔ دیجیتال برای افزودن آیتم‌های بازی."],
  sofreh: ["اسپرسوی دوبل با شیر بخارداده‌شده.", "لایه‌های خمیری سبک با کره و پوستهٔ ترد.", "دانهٔ تازه‌برشته برای دم‌آوری خانگی."],
  golkhaneh: ["رزهای هلویی با برگ‌های سبز برای تبریک و هدیه.", "گل‌های فصل در جعبهٔ هدیهٔ رومیزی.", "گیاه برگ‌دار برای نور غیرمستقیم داخل خانه."],
  khaneh: ["آباژور ایستاده با نور گرم برای گوشهٔ مطالعه.", "مبل تک‌نفرهٔ پارچه‌ای با نشیمن عمیق.", "گلدان دست‌ساز با لعاب مات."],
};

const extraSpecs: Partial<Record<keyof typeof DEMOS, [string, string][][]>> = {
  bazaar: [[["جنس", "سرامیک لعاب‌دار"], ["گنجایش", "۳۲۰ میلی‌لیتر"]]],
  circuit: [[["نمایشگر", "۱۴ اینچ"], ["حافظه", "۵۱۲ گیگابایت"]], [["اتصال", "بلوتوث"], ["شارژ", "کیس USB-C"]], [["درگاه", "USB-C"], ["خروجی", "HDMI"]]],
  arcade: [[["نوع", "کد دیجیتال"], ["ریجن", "آمریکا"]], [["مدت", "یک ماه"], ["نوع", "اشتراک"]], [["نوع", "محتوای دیجیتال"], ["فعال‌سازی", "با حساب بازی"]]],
  khaneh: [[["ارتفاع", "۱۵۰ سانتی‌متر"], ["نور", "گرم"]], [["روکش", "پارچه"], ["عرض", "۸۵ سانتی‌متر"]], [["جنس", "سفال"], ["ارتفاع", "۲۸ سانتی‌متر"]]],
};

export function loadThemeDemo(key: string) {
  if (!Object.hasOwn(DEMOS, key)) return null;
  const demoKey = key as keyof typeof DEMOS;
  const demo = DEMOS[demoKey];
  const definition = TEMPLATE_DEFINITIONS.findLast((item) => item.key === key);
  if (!definition) return null;

  const banner = demoKey === "dookht" ? { file: "dookht-cover.webp", width: 1440, height: 960 } : { file: `${key}.webp`, width: 440, height: 440 };
  const image = { key: `stores/demo/${"0".repeat(32)}.webp`, width: banner.width, height: banner.height };
  const productImages = [1, 2, 3].map((index) => ({ key: `stores/demo/${String(index).repeat(32)}.webp`, width: 480, height: 480 }));
  const categories = demo.products.map(([name], i) => ({ id: `category-${i + 1}`, slug: `category-${i + 1}`, name }));
  const products = demo.products.map(([, name, price], i) => ({
    id: `product-${i + 1}`,
    slug: `product-${i + 1}`,
    name,
    price,
    stockQuantity: [12, 3, 0][i],
    categoryId: categories[i]!.id,
    image: productImages[i],
    description: descriptions[demoKey][i],
    specs: (extraSpecs[demoKey]?.[i] ?? []).map(([label, value]) => ({ label, value })),
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
        contact: { ...definition.settings.contact, address: "تهران، نشانی نمونهٔ فروشگاه" },
        social: definition.settings.social,
        ...(key === "bazaar" ? { description: "کالاهای کاربردی برای خانه، کار و خرید روزمره." } : {}),
      },
      pages,
      categories,
      products,
      images: { "hero-art": image },
    }),
    mediaUrl: (mediaKey: string) => {
      if (mediaKey === image.key) return `/theme-demos/${banner.file}`;
      const productIndex = productImages.findIndex((item) => item.key === mediaKey);
      return productIndex >= 0 ? `/theme-demos/${key}-product-${productIndex + 1}.webp` : null;
    },
  };
}
