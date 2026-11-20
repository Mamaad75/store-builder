import { makeSearchKey, slugify, uniqueSlug } from "@store-builder/shared/lib/text";
import { MAX_CATEGORIES_PER_STORE } from "@store-builder/shared/modules/categories/schemas";
import { CatalogLimitError, ValidationError } from "@store-builder/shared/modules/stores/errors";

/** The fields the category rules work with (the dashboard view carries more, see application/ports.ts). */
export interface CategoryRef {
  id: string;
  name: string;
  slug: string;
}

export const DUPLICATE_NAME = "دسته‌ای با این نام قبلاً ثبت شده است";

export function assertBelowLimit(currentCount: number): void {
  if (currentCount >= MAX_CATEGORIES_PER_STORE) throw new CatalogLimitError("category", MAX_CATEGORIES_PER_STORE);
}

/**
 * Names are unique per store after normalisation (Persian/Arabic letters, digits, harakat, case: makeSearchKey), so "علي 12" and
 * "علی ۱۲" collide. `exceptId` skips the category being renamed.
 */
export function assertUniqueName(existing: readonly CategoryRef[], name: string, exceptId?: string): void {
  const key = makeSearchKey(name);
  if (existing.some((c) => c.id !== exceptId && makeSearchKey(c.name) === key)) throw new ValidationError({ name: [DUPLICATE_NAME] });
}

/** The slug is derived once, at creation, and never changes on rename, so published links keep working. */
export function newSlug(name: string, existing: readonly CategoryRef[]): string {
  return uniqueSlug(slugify(name, "category"), new Set(existing.map((c) => c.slug)));
}

/** The user-facing error for a unique constraint the database enforced (a concurrent insert won the race). */
export function duplicateKeyError(field: "name" | "slug" | null): ValidationError {
  return field ? new ValidationError({ [field]: [DUPLICATE_NAME] }) : new ValidationError({ _form: ["مقدار تکراری است"] });
}
