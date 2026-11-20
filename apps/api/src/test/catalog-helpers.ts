import { createCategoryService, type CategoryService } from "../modules/categories/categories.api.js";
import { createStore } from "../modules/stores/service.js";
import { makeUser, prisma } from "./db-helpers.js";

export const revision = async (storeId: string) =>
  (await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).draftRevision;

/** Two users, each with two stores. */
export async function twoTenants() {
  const a = await makeUser();
  const b = await makeUser();
  const a1 = (await createStore(a.id, { name: "A one", templateKey: "general" })).id;
  const a2 = (await createStore(a.id, { name: "A two", templateKey: "coffee" })).id;
  const b1 = (await createStore(b.id, { name: "B one", templateKey: "general" })).id;
  const b2 = (await createStore(b.id, { name: "B two", templateKey: "fashion" })).id;
  return { a, b, a1, a2, b1, b2 };
}

export const snapshotRows = async (storeId: string) =>
  JSON.stringify({
    store: await prisma.store.findUnique({ where: { id: storeId } }),
    products: await prisma.product.findMany({ where: { storeId }, orderBy: { id: "asc" } }),
    categories: await prisma.productCategory.findMany({ where: { storeId }, orderBy: { id: "asc" } }),
  });

export const validProduct = (over: Record<string, unknown> = {}) => ({ name: "چای سبز", price: 12500, stockQuantity: 5, ...over });

// The category use cases as plain functions for the database tests (production code gets CategoryService through NestJS DI).
const categoryService = createCategoryService();
export const listCategories = (...a: Parameters<CategoryService["list"]>) => categoryService.list(...a);
export const createCategory = (...a: Parameters<CategoryService["create"]>) => categoryService.create(...a);
export const updateCategory = (...a: Parameters<CategoryService["update"]>) => categoryService.update(...a);
export const deleteCategory = (...a: Parameters<CategoryService["delete"]>) => categoryService.delete(...a);
