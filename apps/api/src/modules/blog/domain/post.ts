import { MAX_POSTS_PER_STORE, type PostStatus } from "@store-builder/shared/modules/blog/blog";

export const LIMIT_MESSAGE = `هر فروشگاه حداکثر ${MAX_POSTS_PER_STORE.toLocaleString("fa-IR")} مقاله می‌تواند داشته باشد. یک مقالهٔ قدیمی را حذف کنید.`;

export const canAddPost = (count: number): boolean => count < MAX_POSTS_PER_STORE;

/** When a post was first published: kept once set (unpublishing and publishing again does not change its date); null while it never was. */
export function publishedAtFor(status: PostStatus, current: Date | null, now: Date): Date | null {
  if (status !== "PUBLISHED") return current;
  return current ?? now;
}
