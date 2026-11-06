import { TEMPLATE_DEFINITIONS } from "@/templates/definitions";
import type { StorefrontData } from "@/templates/storefront-data";

const general = TEMPLATE_DEFINITIONS.find((t) => t.key === "general")!;

export const CATEGORY_TEA = { id: "cat-tea", name: "چای", slug: "چای" };
export const CATEGORY_COFFEE = { id: "cat-coffee", name: "قهوه", slug: "قهوه" };

export const PRODUCT_A = { id: "p-a", name: "چای سبز", slug: "چای-سبز", description: "چای سبز ایرانی\nبسته‌بندی ۲۵۰ گرمی", price: 125000, stockQuantity: 20, categoryId: CATEGORY_TEA.id };
export const PRODUCT_B = { id: "p-b", name: "قهوه اسپرسو", slug: "قهوه-اسپرسو", description: "", price: 980000, stockQuantity: 0, categoryId: CATEGORY_COFFEE.id };

/** A complete, valid storefront built from the real `general` seed pages. */
export function makeStorefront(over: Partial<StorefrontData> = {}): StorefrontData {
  return {
    schemaVersion: 1,
    template: { key: "general", version: 1 },
    store: {
      name: "فروشگاه نمونه",
      direction: "rtl",
      primaryColor: "#4f46e5",
      contact: { phone: "۰۲۱-۱۲۳۴۵۶۷۸", email: "shop@example.com", address: "تهران، خیابان آزادی" },
      social: { instagram: "@shop_sample", telegram: "", whatsapp: "" },
    },
    pages: general.pages.map((p, i) => ({ ...p, position: i })) as StorefrontData["pages"],
    categories: [CATEGORY_TEA, CATEGORY_COFFEE],
    products: [PRODUCT_A, PRODUCT_B],
    ...over,
  };
}
