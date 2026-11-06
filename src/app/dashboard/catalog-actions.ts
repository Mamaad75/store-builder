"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import { createCategory, deleteCategory, updateCategory } from "@/modules/categories/service";
import { buildProductsUrl, categoriesUrl, productUrl, productsUrl, storeUrl } from "@/modules/products/list-url";
import type { NoticeCode } from "@/modules/products/notices";
import { parseProductListParams } from "@/modules/products/schemas";
import { changeProductStatus, createProduct, deleteProduct, updateProduct } from "@/modules/products/service";
import {
  CatalogLimitError,
  CategoryNotEmptyError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/modules/stores/errors";

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
  if (e instanceof NotFoundError) redirect(notFoundUrl);
  if (e instanceof ValidationError) {
    return { error: "لطفاً اطلاعات واردشده را بررسی کنید.", fieldErrors: e.fieldErrors };
  }
  if (e instanceof CatalogLimitError) {
    const what = e.kind === "product" ? "محصول" : "دسته‌بندی";
    return { error: `حداکثر ${e.limit.toLocaleString("fa-IR")} ${what} در هر فروشگاه مجاز است.` };
  }
  if (e instanceof ConflictError) return { error: "هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید." };
  if (e instanceof CategoryNotEmptyError) {
    return { error: "این دسته محصول دارد. برای حذف، انتقال محصولات به «بدون دسته» را تأیید کنید." };
  }
  throw e;
}

// ---------------------------------------------------------------- products

export async function createProductAction(_prev: CatalogFormState, fd: FormData): Promise<CatalogFormState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  try {
    await createProduct(user.id, storeId, {
      name: str(fd, "name"),
      description: str(fd, "description"),
      price: str(fd, "price"),
      stockQuantity: str(fd, "stockQuantity"),
      categoryId: str(fd, "categoryId"),
      slug: str(fd, "slug"),
    });
  } catch (e) {
    return toState(e, storeUrl(storeId));
  }
  redirect(buildProductsUrl(storeId, {}, { notice: "product-created" }));
}

export async function updateProductAction(_prev: CatalogFormState, fd: FormData): Promise<CatalogFormState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  const productId = str(fd, "productId");
  try {
    await updateProduct(user.id, storeId, productId, {
      name: str(fd, "name"),
      description: str(fd, "description"),
      price: str(fd, "price"),
      stockQuantity: str(fd, "stockQuantity"),
      categoryId: str(fd, "categoryId"),
      slug: str(fd, "slug"),
    });
  } catch (e) {
    return toState(e, productUrl(storeId, productId));
  }
  revalidatePath(productsUrl(storeId)); // the list (name, price, stock, category) must not show stale data
  return { success: "تغییرات محصول ذخیره شد." };
}

const STATUS_NOTICE: Record<string, NoticeCode> = {
  ACTIVE: "status-activated",
  DRAFT: "status-draft",
  ARCHIVED: "status-archived",
};

/** Plain form action (list buttons). The list's search/filter/page context travels in hidden fields. */
export async function changeProductStatusAction(fd: FormData): Promise<void> {
  const user = await requireUser();
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
    await changeProductStatus(user.id, storeId, productId, target);
  } catch (e) {
    if (e instanceof NotFoundError) redirect(productUrl(storeId, productId));
    if (e instanceof ValidationError) redirect(back("status-invalid"));
    if (e instanceof ConflictError) redirect(back("conflict"));
    throw e;
  }
  redirect(back(STATUS_NOTICE[target] ?? "status-draft"));
}

export async function deleteProductAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  const productId = str(fd, "productId");
  const listParams = parseProductListParams({
    q: str(fd, "q"), category: str(fd, "category"), status: str(fd, "filterStatus"), page: str(fd, "page"), pageSize: str(fd, "pageSize"),
  });
  if (!flag(fd, "confirmDelete")) redirect(buildProductsUrl(storeId, listParams, { notice: "delete-unconfirmed" }));
  try {
    await deleteProduct(user.id, storeId, productId);
  } catch (e) {
    if (e instanceof NotFoundError) redirect(productUrl(storeId, productId));
    throw e;
  }
  redirect(buildProductsUrl(storeId, listParams, { notice: "product-deleted" }));
}

// -------------------------------------------------------------- categories

export async function createCategoryAction(_prev: CatalogFormState, fd: FormData): Promise<CatalogFormState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  try {
    await createCategory(user.id, storeId, { name: str(fd, "name") });
  } catch (e) {
    return toState(e, categoriesUrl(storeId));
  }
  revalidatePath(categoriesUrl(storeId)); // show the new category in the list right away
  return { success: "دسته‌بندی ساخته شد." };
}

export async function updateCategoryAction(_prev: CatalogFormState, fd: FormData): Promise<CatalogFormState> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  const categoryId = str(fd, "categoryId");
  try {
    await updateCategory(user.id, storeId, categoryId, { name: str(fd, "name") });
  } catch (e) {
    return toState(e, `${categoriesUrl(storeId)}/${encodeURIComponent(categoryId)}`);
  }
  revalidatePath(categoriesUrl(storeId));
  revalidatePath(productsUrl(storeId)); // product rows show the category name
  return { success: "نام دسته‌بندی تغییر کرد." };
}

export async function deleteCategoryAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const storeId = str(fd, "storeId");
  const categoryId = str(fd, "categoryId");
  const base = categoriesUrl(storeId);
  let moved = 0;
  try {
    ({ movedProducts: moved } = await deleteCategory(user.id, storeId, categoryId, { moveProducts: flag(fd, "moveProducts") }));
  } catch (e) {
    if (e instanceof NotFoundError) redirect(`${base}/${encodeURIComponent(categoryId)}`);
    if (e instanceof CategoryNotEmptyError) redirect(`${base}?notice=category-not-empty`);
    if (e instanceof ValidationError) redirect(`${base}?notice=category-error`);
    throw e;
  }
  redirect(`${base}?notice=${moved > 0 ? "category-deleted-moved" : "category-deleted"}`);
}
