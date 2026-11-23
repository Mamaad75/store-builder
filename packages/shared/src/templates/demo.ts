import { TEMPLATE_DEFINITIONS } from "./definitions.js";
import { storefrontDataSchema } from "./storefront-data.js";

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

const extendedProducts = {
  "bazaar": [
    [
      "آشپزخانه",
      "کاسهٔ سرامیکی",
      360000,
      "کاسهٔ لعاب‌دار برای سرو روزمره."
    ],
    [
      "نوشت‌افزار",
      "دفتر جلدسخت",
      190000,
      "دفتر خط‌دار با جلد مقاوم برای یادداشت."
    ],
    [
      "دکور",
      "ساعت رومیزی",
      590000,
      "ساعت جمع‌وجور برای میز کار."
    ]
  ],
  "circuit": [
    [
      "موبایل",
      "گوشی هوشمند آبی",
      16800000,
      "گوشی با بدنهٔ مات و نمایشگر بزرگ."
    ],
    [
      "قطعات و تجهیزات",
      "کیبورد مکانیکی",
      3200000,
      "کیبورد مکانیکی برای تایپ و بازی."
    ],
    [
      "گیمینگ",
      "ماوس گیمینگ سبک",
      1420000,
      "ماوس خوش‌دست با حسگر دقیق."
    ]
  ],
  "sormeh": [
    [
      "سرم و مراقبت",
      "سرم صورت",
      740000,
      "سرم سبک برای استفاده در روتین روزانه."
    ],
    [
      "آرایش چشم",
      "ریمل حجم‌دهنده",
      380000,
      "برس متراکم برای پوشش مژه‌ها."
    ],
    [
      "آرایش صورت",
      "پالت رژگونه",
      575000,
      "پالت رنگ‌های ملایم با بافت پودری."
    ]
  ],
  "dookht": [
    [
      "شلوار",
      "جین راسته",
      1950000,
      "شلوار جین با برش راسته."
    ],
    [
      "کیف و اکسسوری",
      "کیف دوشی چرمی",
      2490000,
      "کیف دوشی با بند قابل تنظیم."
    ],
    [
      "کفش",
      "کتانی جیر روشن",
      2750000,
      "کتانی سبک برای استایل روزمره."
    ]
  ],
  "arcade": [
    [
      "بازی",
      "نسخهٔ دانلودی بازی",
      935000,
      "نسخهٔ نمونه برای نمایش اطلاعات دانلود."
    ],
    [
      "عضویت",
      "اشتراک پلتفرم بازی",
      670000,
      "اشتراک نمونه با جزئیات مدت استفاده."
    ],
    [
      "اعتبار حساب",
      "کارت اعتبار دیجیتال",
      1250000,
      "اعتبار حساب برای پلتفرم درج‌شده."
    ]
  ],
  "sofreh": [
    [
      "سردنوش",
      "قهوه سرد",
      132000,
      "نوشیدنی قهوه خنک با یخ."
    ],
    [
      "کیک",
      "کیک شکلاتی",
      149000,
      "برش کیک شکلاتی برای سرو کنار قهوه."
    ],
    [
      "دم‌آوری",
      "دریپر شیشه‌ای",
      490000,
      "دریپر شیشه‌ای برای دم‌آوری دستی."
    ]
  ],
  "golkhaneh": [
    [
      "تولد",
      "دسته‌گل لاله صورتی",
      1150000,
      "لاله‌های صورتی برای هدیهٔ تولد."
    ],
    [
      "گل آپارتمانی",
      "ارکیدهٔ سفید",
      1970000,
      "ارکیدهٔ گل‌دار در گلدان رومیزی."
    ],
    [
      "قدردانی",
      "دسته‌گل ادریسی",
      1570000,
      "ادریسی آبی برای هدیه و قدردانی."
    ]
  ],
  "khaneh": [
    [
      "آشپزخانه",
      "کتری استیل",
      1840000,
      "کتری فلزی برای دم‌نوش و چای."
    ],
    [
      "میز و مبلمان",
      "میز کنارمبلی",
      3820000,
      "میز کنارمبلی با پرداخت چوب گردویی."
    ],
    [
      "پارچه و دکور",
      "کوسن لینن",
      375000,
      "کوسن با رویهٔ پارچه‌ای روشن."
    ]
  ]
} satisfies Record<keyof typeof DEMOS, [string, string, number, string][]>;

export function loadThemeDemo(key: string, version?: number) {
  if (!Object.hasOwn(DEMOS, key)) return null;
  const demoKey = key as keyof typeof DEMOS;
  const demo = DEMOS[demoKey];
  const definition = TEMPLATE_DEFINITIONS.findLast((item) => item.key === key && (version === undefined || item.version === version));
  if (!definition) return null;

  const banner = demoKey === "dookht" ? { file: "dookht-cover.webp", width: 1440, height: 960 } : { file: `${key}.webp`, width: 440, height: 440 };
  const image = { key: `stores/demo/${"0".repeat(32)}.webp`, width: banner.width, height: banner.height };
  const entries = demo.products.map(([category, name, price], i) => ({ category, name, price, description: descriptions[demoKey][i] ?? "" })).concat(definition.version >= 4 ? extendedProducts[demoKey].map(([category, name, price, description]) => ({ category, name, price, description })) : []);
  const productImages = entries.map((_, i) => i + 1).map((index) => ({ key: `stores/demo/${String(index).repeat(32)}.webp`, width: 480, height: 480 }));
  const categories = entries.map(({ category: name }, i) => ({ id: `category-${i + 1}`, slug: `category-${i + 1}`, name }));
  const products = entries.map(({ name, price, description }, i) => ({
    id: `product-${i + 1}`,
    slug: `product-${i + 1}`,
    name,
    price,
    stockQuantity: [12, 3, 0, 6, 2, 8][i],
    categoryId: categories[i]!.id,
    image: productImages[i],
    description,
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
        contact: definition.settings.contact,
        social: definition.settings.social,
        typography: definition.settings.typography,
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
