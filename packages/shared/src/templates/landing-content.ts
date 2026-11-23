import { z } from "zod";
import type { SectionDefinition, ThemeDefinition } from "./theme.js";

const copy = {
  "bazaar": [
    "بازار امروز",
    "از خانه تا دیجیتال، انتخاب را از دسته‌ها شروع کنید.",
    "دسترسی سریع به دسته‌ها",
    "ویترین بازار",
    "انتخاب‌های امروز",
    "کالاهای آمادهٔ خرید",
    "راهنمای خرید از بازار",
    "از دسته شروع کنید|دسته‌بندی‌ها کمک می‌کنند گزینه‌های مرتبط را زودتر پیدا کنید.\nجزئیات را بررسی کنید|قیمت و موجودی در صفحهٔ هر کالا نمایش داده می‌شود."
  ],
  "circuit": [
    "تجهیزات دیجیتال، دقیق‌تر انتخاب کنید",
    "دستگاه‌ها، قطعات و لوازم جانبی را بر اساس کاربرد و مشخصات مرور کنید.",
    "مستقیم به بخش دیجیتال",
    "میز کار و سرگرمی",
    "ویترین تجهیزات",
    "دیجیتال‌های موجود",
    "پیش از انتخاب دستگاه",
    "سازگاری اتصال|نوع درگاه و لوازم مورد نیاز را در مشخصات بررسی کنید.\nانتخاب بر اساس کاربرد|نیازهای کار، بازی و سفر را پیش از مقایسه مشخص کنید."
  ],
  "sormeh": [
    "زیبایی، به سبک خودتان",
    "از رنگ و رایحه تا مراقبت روزانه، از نیازتان شروع کنید.",
    "زیبایی بر اساس نیاز",
    "روتین روزمره",
    "انتخاب‌های زیبایی",
    "محصولات موجود برای روتین",
    "راهنمای ساخت روتین",
    "انتخاب بافت|بافت و پوشش محصول را پیش از انتخاب بررسی کنید.\nترتیب روتین|به روش مصرف نوشته‌شده روی هر محصول توجه کنید."
  ],
  "dookht": [
    "کمد این فصل",
    "لباس‌های لایه‌پذیر و اکسسوری‌ها را برای موقعیت‌های مختلف پیدا کنید.",
    "خرید بر اساس استایل",
    "داستان یک استایل",
    "منتخب کلکسیون",
    "آمادهٔ پوشیدن",
    "راهنمای انتخاب پوشاک",
    "انتخاب اندازه|اندازه‌های لباس مشابه را با راهنمای سایز مقایسه کنید.\nنگهداری لباس|جنس پارچه و دستور شست‌وشو را بررسی کنید."
  ],
  "arcade": [
    "بازی بعدی از اینجا شروع می‌شود",
    "گیفت‌کارت، اشتراک و محتوای دانلودی را بر اساس پلتفرم مرور کنید.",
    "مسیرهای ورود به بازی",
    "ویترین پلتفرم‌ها",
    "آیتم‌های منتخب",
    "کدها و اشتراک‌های موجود",
    "پیش از انتخاب کد",
    "ریجن حساب|کشور یا منطقهٔ حساب را با مشخصات محصول تطبیق دهید.\nفعال‌سازی|راهنمای محصول را بخوانید و برای پیگیری از راه‌های تماس فروشگاه استفاده کنید."
  ],
  "sofreh": [
    "از اولین جرعه تا آخرین لقمه",
    "منوی کافه، شیرینی‌ها و قهوهٔ خانگی را یکجا مرور کنید.",
    "منو بر اساس ذائقه",
    "برای دم‌آوری در خانه",
    "منتخب کافه",
    "خوراکی‌های موجود",
    "پیش از سفارش از کافه",
    "حساسیت غذایی|پیش از سفارش دربارهٔ مواد اولیه از کافه بپرسید.\nتحویل سفارش|زمان و روش تحویل را از راه تماس کافه هماهنگ کنید."
  ],
  "golkhaneh": [
    "برای هر مناسبت، یک گل",
    "دسته‌گل، باکس هدیه و گیاه را بر اساس مناسبت و فضا پیدا کنید.",
    "انتخاب گل بر اساس مناسبت",
    "گل برای کسی که دوستش دارید",
    "منتخب گلخانه",
    "گل‌ها و گیاهان موجود",
    "راهنمای هدیه و نگهداری",
    "انتخاب برای مناسبت|اندازه و رنگ دسته‌گل را با مناسبت و فضای هدیه هماهنگ کنید.\nپیام همراه گل|متن پیام و زمان تحویل را با فروشگاه هماهنگ کنید."
  ],
  "khaneh": [
    "خانه را اتاق‌به‌اتاق کامل کنید",
    "برای نشیمن، نورپردازی و دکور از یک فضای مشخص شروع کنید.",
    "خرید بر اساس فضای خانه",
    "ایده برای یک گوشهٔ خانه",
    "منتخب خانه",
    "کالاهای موجود برای چیدمان",
    "پیش از خرید لوازم خانه",
    "اندازه‌گیری فضا|ابعاد کالا را با محل استفاده و مسیر حمل مقایسه کنید.\nارسال و خدمات|شرایط تحویل و گارانتی را از فروشگاه پیگیری کنید."
  ]
} as const;

export type LandingKey = keyof typeof copy;
export const LANDING_KEYS = Object.keys(copy) as LandingKey[];

const title = z.string().min(1).max(120);
const body = z.string().max(600);
const category = z.string().max(60);
const categoryField = { name: "category", label: "نام یا نامک دسته (اختیاری)", kind: "text", max: 60 } as const;
const titleField = { name: "title", label: "عنوان بخش", kind: "text", max: 120 } as const;
const summaryField = { name: "body", label: "توضیح", kind: "textarea", max: 600 } as const;

const spotlightTitles: Record<LandingKey, string> = {
  bazaar: "ویترین دسته‌های بازار",
  circuit: "زیر ذره‌بین؛ مشخصات کلیدی",
  sormeh: "سه انتخاب برای روتین",
  dookht: "ایده‌های استایل",
  arcade: "پلتفرم بعدی‌تان را انتخاب کنید",
  sofreh: "کنار قهوه چه می‌چسبد؟",
  golkhaneh: "از مناسبت تا دسته‌گل",
  khaneh: "ایده‌های چیدمان اتاق",
};

export function landingTheme(theme: ThemeDefinition): ThemeDefinition {
  const [, summary, discovery, campaign, shelf, , guide, items] = copy[theme.key as LandingKey];
  const sectionDefinitions: SectionDefinition[] = [
    {
      type: `${theme.key}.spotlight`, label: spotlightTitles[theme.key as LandingKey], image: false,
      schema: z.object({ title, body, limit: z.number().int().min(2).max(6) }).strict(),
      defaults: { title: spotlightTitles[theme.key as LandingKey], body: "", limit: 3 },
      fields: [titleField, summaryField, { name: "limit", label: "حداکثر آیتم‌ها", kind: "number", min: 2, max: 6 }],
    },
    {
      type: `${theme.key}.discovery`, label: discovery, image: false,
      schema: z.object({ title, limit: z.number().int().min(2).max(12) }).strict(),
      defaults: { title: discovery, limit: 8 },
      fields: [titleField, { name: "limit", label: "حداکثر دسته‌ها", kind: "number", min: 2, max: 12 }],
    },
    {
      type: `${theme.key}.campaign`, label: "بنر داستان و پیشنهاد", image: true,
      schema: z.object({ title, body, category, action: z.string().max(45), imageId: z.string().min(1).max(64).nullable() }).strict(),
      defaults: { title: campaign, body: summary, category: "", action: "مرور محصولات", imageId: null },
      fields: [titleField, summaryField, categoryField, { name: "action", label: "متن دکمه", kind: "text", max: 45 }],
    },
    {
      type: `${theme.key}.shelf`, label: "قفسهٔ محصولات", image: false,
      schema: z.object({ title, category, limit: z.number().int().min(2).max(12), availability: z.number().int().min(0).max(1) }).strict(),
      defaults: { title: shelf, category: "", limit: 6, availability: 0 },
      fields: [titleField, categoryField, { name: "limit", label: "حداکثر محصولات", kind: "number", min: 2, max: 12 }, { name: "availability", label: "فقط موجودها (۱ = بله، ۰ = خیر)", kind: "number", min: 0, max: 1 }],
    },
    {
      type: `${theme.key}.guide`, label: guide, image: false,
      schema: z.object({ title, items: z.string().max(1600) }).strict(),
      defaults: { title: guide, items },
      fields: [titleField, { name: "items", label: "راهنما (هر خط: عنوان | توضیح)", kind: "textarea", max: 1600 }],
    },
  ];
  return {
    ...theme, version: 4,
    meta: { ...theme.meta, description: summary },
    sectionDefinitions: [...theme.sectionDefinitions, ...sectionDefinitions],
    editor: { pages: { ...theme.editor.pages, HOME: {
      ...theme.editor.pages.HOME,
      allowed: [...theme.editor.pages.HOME.allowed, ...sectionDefinitions.map((section) => section.type)],
      singletons: [...theme.editor.pages.HOME.singletons, ...sectionDefinitions.filter((section) => !section.type.endsWith(".shelf")).map((section) => section.type)],
    } } },
  };
}

export function landingCopy(key: LandingKey) {
  const [title, subtitle, , , , available] = copy[key];
  return { title, subtitle, available };
}
