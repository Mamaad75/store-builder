import { sectionPropsSchemas, type SectionProps, type SectionType } from "./sections";

/** Persian labels used by the dashboard. */
export const SECTION_LABELS: Record<SectionType, string> = {
  hero: "بنر اصلی",
  featuredProducts: "محصولات ویژه",
  productGrid: "فهرست محصولات",
  categoryFilter: "فیلتر دسته‌بندی",
  productDetail: "جزئیات محصول",
  richText: "متن",
  imageText: "تصویر و متن",
  contactInfo: "اطلاعات تماس",
  callToAction: "دعوت به اقدام",
};

/** Initial props of a newly added section. Every entry is validated against the strict schema in the tests. */
export const SECTION_DEFAULTS: { [T in SectionType]: SectionProps<T> } = {
  hero: { title: "عنوان بنر", subtitle: "", buttonText: "مشاهده محصولات", buttonLink: "/products", imageId: null },
  featuredProducts: { title: "محصولات ویژه", limit: 4 },
  productGrid: { title: "همه محصولات" },
  categoryFilter: {},
  productDetail: {},
  richText: { title: "عنوان", body: "" },
  imageText: { title: "عنوان", body: "", imageId: null },
  contactInfo: { title: "تماس با ما", body: "" },
  callToAction: { title: "عنوان", buttonText: "تماس با ما", buttonLink: "/contact" },
};

/** Fresh copy; throws if a default ever stops satisfying its schema. */
export function defaultSectionProps<T extends SectionType>(type: T): SectionProps<T> {
  return sectionPropsSchemas[type].parse(structuredClone(SECTION_DEFAULTS[type])) as SectionProps<T>;
}
