/**
 * The dashboard's getting-started checklist. DERIVED from the data every time (nothing is stored, so it can never be stale
 * or dismissed by mistake): it follows the newest store that is not published yet and disappears once every store is live.
 */
export interface OnboardingFacts {
  id: string;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  categories: number;
  products: number;
  hasSubdomain: boolean;
}

export interface OnboardingStep {
  key: "store" | "category" | "product" | "subdomain" | "publish";
  label: string;
  done: boolean;
  href: string;
}

export interface Onboarding {
  storeName: string | null;
  steps: OnboardingStep[];
  doneCount: number;
}

export function buildOnboarding(stores: OnboardingFacts[]): Onboarding | null {
  if (stores.length > 0 && stores.every((s) => s.status === "PUBLISHED")) return null;
  const focus = stores.find((s) => s.status !== "PUBLISHED") ?? null; // newest first
  const base = focus ? `/dashboard/stores/${focus.id}` : "/dashboard/stores/new";
  const steps: OnboardingStep[] = [
    { key: "store", label: "ساخت فروشگاه", done: stores.length > 0, href: "/dashboard/stores/new" },
    { key: "category", label: "افزودن دسته‌بندی", done: !!focus && focus.categories > 0, href: focus ? `${base}/categories` : base },
    { key: "product", label: "افزودن اولین محصول", done: !!focus && focus.products > 0, href: focus ? `${base}/products/new` : base },
    { key: "subdomain", label: "انتخاب آدرس فروشگاه", done: !!focus && focus.hasSubdomain, href: focus ? `${base}/publish` : base },
    { key: "publish", label: "انتشار فروشگاه", done: false, href: focus ? `${base}/publish` : base },
  ];
  return { storeName: focus?.name ?? null, steps, doneCount: steps.filter((s) => s.done).length };
}
