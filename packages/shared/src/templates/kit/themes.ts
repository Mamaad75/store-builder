import type { ThemeDefinition } from "../theme.js";
import { kitTheme, linesSection, noticeSection, sizeGuideSection } from "./kit-sections.js";

/**
 * The eight business-oriented themes of 2026-11 (owner-approved directions; original designs, not copies of any brand).
 * Pure data only: identity, display metadata, extra sections and editor rules. Visuals live in apps/web/src/templates/<key>/.
 * A published (key, version) is immutable; a redesign is a new version.
 */

export const bazaarTheme: ThemeDefinition = kitTheme({
  key: "bazaar",
  promos: "تازه‌های فروشگاه | محصولاتی که همین هفته رسیده‌اند |\nانتخاب مشتری‌ها | پرفروش‌ترین کالاهای ماه |",
  meta: { name: "بازار", description: "فروشگاه پرکالا و چندمنظوره: دسته‌های دایره‌ای، کارت‌های فشرده و جست‌وجوی سریع میان دسته‌ها." },
  highlights: { title: "", items: "ارسال سریع: به سراسر کشور\nضمانت بازگشت: ۷ روز\nپرداخت امن: درگاه بانکی\nپشتیبانی: هر روز ۹ تا ۲۱" },
});

export const circuitTheme: ThemeDefinition = kitTheme({
  key: "circuit",
  promos: "لپ‌تاپ و کامپیوتر | قدرت برای کار، درس و بازی |\nموبایل و لوازم جانبی | مدل‌های تازه با گارانتی معتبر |",
  meta: { name: "مدار", description: "دیجیتال و تکنولوژی: هیروی گرافیتی، مشخصات کلیدی روی هر کارت و وضعیت موجودی روشن." },
  highlights: { title: "خرید مطمئن", items: "گارانتی معتبر: برای همه‌ی کالاهای دیجیتال\nتست قبل از ارسال: برای کالاهای باز\nارسال بیمه‌شده: برای کالاهای گران\nمشاوره‌ی خرید: تلفنی و رایگان" },
});

export const sormehTheme: ThemeDefinition = kitTheme({
  key: "sormeh",
  promos: "مراقبت از پوست | روتین روزانه، متناسب با پوست شما |\nعطر و ادکلن | رایحه‌ای که در یاد می‌ماند |",
  meta: { name: "سُرمه", description: "آرایشی، بهداشتی و عطر: قاب‌های طاقی، رنگ‌های پودری و دکمه‌های کپسولی." },
  categoriesTitle: "بر اساس نیاز شما",
  highlights: { title: "", items: "اصالت کالا: تضمین‌شده\nمشاوره‌ی پوست: رایگان\nبسته‌بندی هدیه: به انتخاب شما\nارسال: ۱ تا ۳ روز کاری" },
});

export const dookhtTheme: ThemeDefinition = kitTheme({
  key: "dookht",
  promos: "کلکسیون تازه | طرح‌های این فصل را ببینید |\nلباس روزمره | راحت، ساده و خوش‌دوخت |",
  meta: { name: "دوخت", description: "پوشاک و مد: عکس‌های تمام‌قد، تایپوگرافی درشت و گوشه‌های تیز." },
  categoriesTitle: "",
  highlights: { title: "", items: "مرجوعی: تا ۱۴ روز\nتعویض سایز: بدون هزینه\nارسال: ۲ تا ۴ روز کاری\nپرداخت: امن" },
  extras: [{ def: sizeGuideSection("dookht"), pages: ["PRODUCTS", "ABOUT"] }],
});

export const arcadeTheme: ThemeDefinition = kitTheme({
  key: "arcade",
  promos: "گیفت‌کارت | کد معتبر با تحویل سریع |\nاشتراک سرویس‌ها | موسیقی، فیلم و بازی |",
  meta: { name: "آرکید", description: "اشتراک، گیفت‌کارت و محصولات دانلودی: تم تیره، کارت‌های پهن و جدول ویژگی هر محصول." },
  categoriesTitle: "پلتفرم‌ها",
  highlights: { title: "", items: "تحویل سریع: کد در حساب شما\nپشتیبانی: ۱۰ صبح تا ۱۲ شب\nضمانت سالم بودن کد: یا بازگشت وجه\nراهنمای فعال‌سازی: برای هر محصول" },
  extras: [
    {
      def: linesSection("arcade", "steps", "مراحل دریافت", "مراحل (هر خط یک مرحله؛ «عنوان: توضیح»)", {
        title: "از خرید تا فعال‌سازی",
        items: "انتخاب محصول: پلتفرم و ریجن را با دقت انتخاب کنید\nپرداخت: از درگاه بانکی\nدریافت کد: در پیام فروشگاه یا حساب کاربری\nفعال‌سازی: با راهنمای همان محصول",
        note: "",
      }),
      pages: ["HOME", "ABOUT", "CONTACT"],
    },
  ],
});

export const sofrehTheme: ThemeDefinition = kitTheme({
  key: "sofreh",
  promos: "قهوه‌ی تازه‌برشته | دانه‌ها را هر هفته برشته می‌کنیم |\nشیرینی روز | پخت هر صبح، همان روز |",
  meta: { name: "سفره", description: "خوراکی و کافه: تابلوی منو، ساعت کاری، عکس‌های گرد و سفارش از واتس‌اپ." },
  highlights: { title: "", items: "تازه و روزانه: پخت هر صبح\nبسته‌بندی بهداشتی: مناسب ارسال\nسفارش واتس‌اپ: پاسخ سریع\nتحویل حضوری: در محل فروشگاه" },
  extras: [
    {
      def: linesSection("sofreh", "menu", "منو", "اقلام (هر خط یک مورد؛ «نام: قیمت»)", {
        title: "منوی امروز",
        items: "اسپرسو دوبل: ۹۵٬۰۰۰\nلاته: ۱۲۰٬۰۰۰\nدمنوش به‌لیمو: ۸۵٬۰۰۰\nکیک خرما و گردو: ۱۱۰٬۰۰۰",
        note: "قیمت‌ها به تومان است.",
      }),
      pages: ["HOME", "ABOUT"],
    },
    {
      def: linesSection("sofreh", "hours", "ساعت کاری", "ساعت‌ها (هر خط یک مورد؛ «روز: ساعت»)", {
        title: "ساعت کاری",
        items: "شنبه تا چهارشنبه: ۸ تا ۲۲\nپنجشنبه: ۸ تا ۲۴\nجمعه: ۱۰ تا ۲۲",
        note: "",
      }),
      pages: ["HOME", "ABOUT", "CONTACT"],
    },
  ],
});

export const golkhanehTheme: ThemeDefinition = kitTheme({
  key: "golkhaneh",
  promos: "دسته‌گل | برای تولد، سالگرد و هر بهانه‌ای |\nگیاه آپارتمانی | سبزی ماندگار برای خانه و دفتر |",
  meta: { name: "گلخانه", description: "گل و گیاه: قاب‌های طاقی مثل پنجره‌ی گلخانه، رنگ‌های گیاهی و نوار مهلت ارسال." },
  categoriesTitle: "برای چه مناسبتی؟",
  highlights: { title: "", items: "تازگی گل: تا ۵ روز\nکارت پیام: رایگان و دست‌نویس\nارسال همان روز: برای سفارش‌های صبح\nراهنمای نگهداری: همراه هر گیاه" },
  extras: [
    {
      def: noticeSection("golkhaneh", "delivery", "مهلت ارسال", {
        title: "ارسال همان روز",
        body: "سفارش‌هایی که تا ساعت ۱۸ ثبت شوند، همان روز تحویل داده می‌شوند.",
        badge: "تا ساعت ۱۸",
      }),
      pages: ["HOME", "PRODUCTS", "CONTACT"],
    },
  ],
});

export const khanehTheme: ThemeDefinition = kitTheme({
  key: "khaneh",
  promos: "آشپزخانه | لوازم برقی و پخت‌وپز |\nشست‌وشو و نظافت | کالاهای مطمئن با گارانتی |",
  meta: { name: "خانه", description: "لوازم خانگی و دکوراسیون: تصویر کامل کالا روی زمینه‌ی سفید، مشخصه‌ی کلیدی و نوار خدمات." },
  categoriesTitle: "برای کجای خانه؟",
  highlights: { title: "خدمات فروشگاه", items: "نصب: راهنمایی یا نصب در محل\nگارانتی و خدمات: طبق شرایط هر کالا\nارسال کالای حجیم: تا درب منزل\nمشاوره‌ی خرید: تلفنی" },
});

/** In the order offered to merchants (matches the business categories). */
export const KIT_THEMES: readonly ThemeDefinition[] = [bazaarTheme, circuitTheme, sormehTheme, dookhtTheme, arcadeTheme, sofrehTheme, golkhanehTheme, khanehTheme];

/** The visual refresh shares the original section schemas and editor rules. */
export const KIT_THEMES_V2: readonly ThemeDefinition[] = KIT_THEMES.map((theme) => ({ ...theme, version: 2 }));

export const bazaarMarketTheme: ThemeDefinition = {
  ...bazaarTheme,
  version: 3,
  meta: { name: "بازار", description: "فروشگاه چندمنظوره با جست‌وجوی مرکزی، دسته‌های دایره‌ای، قفسه‌های افقی و شبکهٔ فشردهٔ کالا." },
};

export const circuitStudioTheme: ThemeDefinition = { ...circuitTheme, version: 3 };
export const sormehStudioTheme: ThemeDefinition = { ...sormehTheme, version: 3 };
export const dookhtStudioTheme: ThemeDefinition = { ...dookhtTheme, version: 3 };
export const arcadeStudioTheme: ThemeDefinition = { ...arcadeTheme, version: 3 };
export const sofrehStudioTheme: ThemeDefinition = { ...sofrehTheme, version: 3 };
export const golkhanehStudioTheme: ThemeDefinition = { ...golkhanehTheme, version: 3 };
export const khanehStudioTheme: ThemeDefinition = { ...khanehTheme, version: 3 };

export const KIT_THEMES_V3: readonly ThemeDefinition[] = [bazaarMarketTheme, circuitStudioTheme, sormehStudioTheme, dookhtStudioTheme, arcadeStudioTheme, sofrehStudioTheme, golkhanehStudioTheme, khanehStudioTheme];
