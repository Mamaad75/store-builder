import * as api from "@/client/api";
import { transportState, unexpected } from "@/client/guard";
import { go, refresh } from "@/client/nav";
import { buildProductsUrl, categoriesUrl, productUrl, storeUrl } from "@store-builder/shared/modules/products/list-url";
import type { NoticeCode } from "@store-builder/shared/modules/products/notices";
import { parseProductListParams } from "@store-builder/shared/modules/products/schemas";
import { specsFromForm } from "@store-builder/shared/modules/products/specs-form";
import {
  CatalogLimitError,
  CategoryNotEmptyError,
  ConflictError,
  DRAFT_BUSY_MESSAGE,
  DraftBusyError,
  NotFoundError,
  ValidationError,
} from "@store-builder/shared/modules/stores/errors";

export interface CatalogFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const flag = (fd: FormData, key: string) => ["on", "true", "yes"].includes(str(fd, key));

/**
 * Pattern for every action: (1) identity from the server session only, (2) input built from an explicit
 * whitelist of form fields (never spread FormData), (3) delegate to the owner-scoped service.
 * A missing OR foreign resource always redirects to the resource's own URL, which answers 404.
 */
function toState(e: unknown, notFoundUrl: string): CatalogFormState {
  const transport = transportState(e);
  if (transport) return transport;
  if (e instanceof NotFoundError) {
    go(notFoundUrl);
    return {};
  }
  if (e instanceof ValidationError) {
    return { error: "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: e.fieldErrors };
  }
  if (e instanceof CatalogLimitError) {
    const what = e.kind === "product" ? "محصول" : "دسته‌بندی";
    return { error: `حداکثر ${e.limit.toLocaleString("fa-IR")} ${what} در هر فروشگاه مجاز است.` };
  }
  if (e instanceof ConflictError) return { error: "هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید." };
  if (e instanceof DraftBusyError) return { error: DRAFT_BUSY_MESSAGE };
  if (e instanceof CategoryNotEmptyError) {
    return { error: "این دسته محصول دارد. برای حذف، انتقال محصولات به «بدون دسته» را تأیید کنید." };
  }
  throw e;
}

// ---------------------------------------------------------------- products

export async function createProductAction(_prev: CatalogFormState, fd: FormData): Promise<CatalogFormState> {
  const storeId = str(fd, "storeId");
  try {
    await api.createProduct(storeId, {
      name: str(fd, "name"),
      description: str(fd, "description"),
      price: str(fd, "price"),
      stockQuantity: str(fd, "stockQuantity"),
      categoryId: str(fd, "categoryId"),
      slug: str(fd, "slug"),
      specs: specsFromForm(fd),
    });
  } catch (e) {
    return toState(e, storeUrl(storeId));
  }
  go(buildProductsUrl(storeId, {}, { notice: "product-created" }));
  return {};
}

export async function updateProductAction(_prev: CatalogFormState, fd: FormData): Promise<CatalogFormState> {
  const storeId = str(fd, "storeId");
  const productId = str(fd, "productId");
  try {
    await api.updateProduct(storeId, productId, {
      name: str(fd, "name"),
      description: str(fd, "description"),
      price: str(fd, "price"),
      stockQuantity: str(fd, "stockQuantity"),
      categoryId: str(fd, "categoryId"),
      slug: str(fd, "slug"),
      confirmSlugChange: str(fd, "confirmSlugChange") === "true",
      specs: specsFromForm(fd),
    });
  } catch (e) {
    return toState(e, productUrl(storeId, productId));
  }
  refresh();
  return { success: "تغییرات محصول ذخیره شد." };
}

const STATUS_NOTICE: Record<string, NoticeCode> = {
  ACTIVE: "status-activated",
  DRAFT: "status-draft",
  ARCHIVED: "status-archived",
};

/** Plain form action (list buttons). The list's search/filter/page context travels in hidden fields. */
export async function changeProductStatusAction(fd: FormData): Promise<void> {
  const storeId = str(fd, "storeId");
  const productId = str(fd, "productId");
  const target = str(fd, "status");
  const listParams = parseProductListParams({
    q: str(fd, "q"), category: str(fd, "category"), status: str(fd, "filterStatus"), page: str(fd, "page"), pageSize: str(fd, "pageSize"),
  });
  const back = (notice: NoticeCode) =>
    str(fd, "returnTo") === "edit"
      ? `${productUrl(storeId, productId)}?notice=${notice}`
      : buildProductsUrl(storeId, listParams, { notice });
  try {
    await api.changeProductStatus(storeId, productId, target);
  } catch (e) {
    if (e instanceof NotFoundError) return void go(productUrl(storeId, productId));
    if (e instanceof ValidationError) return void go(back("status-invalid"));
    if (e instanceof ConflictError) return void go(back("conflict"));
    if (e instanceof DraftBusyError) return void go(back("busy"));
    return void unexpected(e);
  }
  return void go(back(STATUS_NOTICE[target] ?? "status-draft"));
}

export async function deleteProductAction(fd: FormData): Promise<void> {
  const storeId = str(fd, "storeId");
  const productId = str(fd, "productId");
  const listParams = parseProductListParams({
    q: str(fd, "q"), category: str(fd, "category"), status: str(fd, "filterStatus"), page: str(fd, "page"), pageSize: str(fd, "pageSize"),
  });
  if (!flag(fd, "confirmDelete")) return void go(buildProductsUrl(storeId, listParams, { notice: "delete-unconfirmed" }));
  try {
    await api.deleteProduct(storeId, productId);
  } catch (e) {
    if (e instanceof NotFoundError) return void go(productUrl(storeId, productId));
    if (e instanceof DraftBusyError) return void go(buildProductsUrl(storeId, listParams, { notice: "busy" }));
    return void unexpected(e);
  }
  return void go(buildProductsUrl(storeId, listParams, { notice: "product-deleted" }));
}

// -------------------------------------------------------------- categories

export async function createCategoryAction(_prev: CatalogFormState, fd: FormData): Promise<CatalogFormState> {
  const storeId = str(fd, "storeId");
  try {
    await api.createCategory(storeId, { name: str(fd, "name") });
  } catch (e) {
    return toState(e, categoriesUrl(storeId));
  }
  refresh();
  return { success: "دسته‌بندی ساخته شد." };
}

export async function updateCategoryAction(_prev: CatalogFormState, fd: FormData): Promise<CatalogFormState> {
  const storeId = str(fd, "storeId");
  const categoryId = str(fd, "categoryId");
  try {
    await api.updateCategory(storeId, categoryId, { name: str(fd, "name") });
  } catch (e) {
    return toState(e, `${categoriesUrl(storeId)}/${encodeURIComponent(categoryId)}`);
  }
  refresh();
  return { success: "نام دسته‌بندی تغییر کرد." };
}

export async function deleteCategoryAction(fd: FormData): Promise<void> {
  const storeId = str(fd, "storeId");
  const categoryId = str(fd, "categoryId");
  const base = categoriesUrl(storeId);
  let moved = 0;
  try {
    ({ movedProducts: moved } = await api.deleteCategory(storeId, categoryId, { moveProducts: flag(fd, "moveProducts") }));
  } catch (e) {
    if (e instanceof NotFoundError) return void go(`${base}/${encodeURIComponent(categoryId)}`);
    if (e instanceof CategoryNotEmptyError) return void go(`${base}?notice=category-not-empty`);
    if (e instanceof ValidationError) return void go(`${base}?notice=category-error`);
    if (e instanceof DraftBusyError) return void go(`${base}?notice=busy`);
    return void unexpected(e);
  }
  return void go(`${base}?notice=${moved > 0 ? "category-deleted-moved" : "category-deleted"}`);
}
