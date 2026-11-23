/**
 * Iran's 31 provinces (phase 3.3, D33-1). The code is a stable ASCII key (stored in addresses and shipping rules; the database checks
 * the shape, the application checks membership); the name is what shoppers see. `cities` are SUGGESTIONS for the address form (the
 * capital first): a shopper in a town that is not listed still types it, because a rigid list would block real deliveries.
 */
export interface Province {
  code: string;
  name: string;
  cities: readonly string[];
}

export const PROVINCES: readonly Province[] = [
  { code: "tehran", name: "تهران", cities: ["تهران", "شهریار", "اسلامشهر", "ری", "ورامین", "قدس", "ملارد", "پاکدشت", "دماوند", "رباط‌کریم"] },
  { code: "alborz", name: "البرز", cities: ["کرج", "فردیس", "نظرآباد", "هشتگرد", "اشتهارد"] },
  { code: "isfahan", name: "اصفهان", cities: ["اصفهان", "کاشان", "خمینی‌شهر", "نجف‌آباد", "شاهین‌شهر", "شهرضا", "مبارکه", "فولادشهر"] },
  { code: "fars", name: "فارس", cities: ["شیراز", "مرودشت", "کازرون", "جهرم", "فسا", "لار", "داراب", "آباده"] },
  { code: "khorasan-razavi", name: "خراسان رضوی", cities: ["مشهد", "نیشابور", "سبزوار", "تربت حیدریه", "قوچان", "کاشمر", "تربت جام"] },
  { code: "khuzestan", name: "خوزستان", cities: ["اهواز", "دزفول", "آبادان", "خرمشهر", "بهبهان", "ماهشهر", "اندیمشک", "شوشتر", "ایذه"] },
  { code: "azarbaijan-sharghi", name: "آذربایجان شرقی", cities: ["تبریز", "مراغه", "مرند", "میانه", "اهر", "بناب", "سراب"] },
  { code: "azarbaijan-gharbi", name: "آذربایجان غربی", cities: ["ارومیه", "خوی", "بوکان", "مهاباد", "میاندوآب", "سلماس", "نقده"] },
  { code: "ardabil", name: "اردبیل", cities: ["اردبیل", "پارس‌آباد", "مشگین‌شهر", "خلخال"] },
  { code: "ilam", name: "ایلام", cities: ["ایلام", "دهلران", "ایوان", "آبدانان"] },
  { code: "bushehr", name: "بوشهر", cities: ["بوشهر", "برازجان", "کنگان", "گناوه", "جم"] },
  { code: "chaharmahal-bakhtiari", name: "چهارمحال و بختیاری", cities: ["شهرکرد", "بروجن", "فارسان", "لردگان"] },
  { code: "khorasan-jonoubi", name: "خراسان جنوبی", cities: ["بیرجند", "قائن", "طبس", "فردوس"] },
  { code: "khorasan-shomali", name: "خراسان شمالی", cities: ["بجنورد", "شیروان", "اسفراین"] },
  { code: "zanjan", name: "زنجان", cities: ["زنجان", "ابهر", "خرمدره"] },
  { code: "semnan", name: "سمنان", cities: ["سمنان", "شاهرود", "دامغان", "گرمسار"] },
  { code: "sistan-baluchestan", name: "سیستان و بلوچستان", cities: ["زاهدان", "زابل", "چابهار", "ایرانشهر", "سراوان"] },
  { code: "qazvin", name: "قزوین", cities: ["قزوین", "تاکستان", "الوند", "بوئین‌زهرا"] },
  { code: "qom", name: "قم", cities: ["قم"] },
  { code: "kurdistan", name: "کردستان", cities: ["سنندج", "سقز", "مریوان", "بانه", "بیجار", "قروه"] },
  { code: "kerman", name: "کرمان", cities: ["کرمان", "سیرجان", "رفسنجان", "جیرفت", "بم", "زرند"] },
  { code: "kermanshah", name: "کرمانشاه", cities: ["کرمانشاه", "اسلام‌آباد غرب", "کنگاور", "هرسین", "سنقر"] },
  { code: "kohgiluyeh-boyerahmad", name: "کهگیلویه و بویراحمد", cities: ["یاسوج", "دهدشت", "دوگنبدان"] },
  { code: "golestan", name: "گلستان", cities: ["گرگان", "گنبد کاووس", "علی‌آباد کتول", "بندر ترکمن", "آق‌قلا"] },
  { code: "gilan", name: "گیلان", cities: ["رشت", "بندر انزلی", "لاهیجان", "لنگرود", "تالش", "آستارا", "رودسر"] },
  { code: "lorestan", name: "لرستان", cities: ["خرم‌آباد", "بروجرد", "دورود", "الیگودرز", "کوهدشت"] },
  { code: "mazandaran", name: "مازندران", cities: ["ساری", "بابل", "آمل", "قائم‌شهر", "بهشهر", "تنکابن", "نوشهر", "چالوس", "بابلسر"] },
  { code: "markazi", name: "مرکزی", cities: ["اراک", "ساوه", "خمین", "محلات", "دلیجان"] },
  { code: "hormozgan", name: "هرمزگان", cities: ["بندرعباس", "قشم", "کیش", "میناب", "بندر لنگه"] },
  { code: "hamedan", name: "همدان", cities: ["همدان", "ملایر", "نهاوند", "اسدآباد", "تویسرکان"] },
  { code: "yazd", name: "یزد", cities: ["یزد", "میبد", "اردکان", "بافق", "مهریز"] },
];

/** The shape the database CHECKs (membership is checked here). */
export const PROVINCE_CODE_RE = /^[a-z]+(?:-[a-z]+)?$/;

const BY_CODE = new Map(PROVINCES.map((p) => [p.code, p]));

export function isProvinceCode(code: unknown): code is string {
  return typeof code === "string" && BY_CODE.has(code);
}

export function provinceName(code: string): string | null {
  return BY_CODE.get(code)?.name ?? null;
}
