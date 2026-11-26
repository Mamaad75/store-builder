import type { PostInput, PostStatus } from "@store-builder/shared/modules/blog/blog";

export interface PostRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  status: PostStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
/** The caller's store: the owner id is what the draft-mutation lock is keyed by (a staff member acts for the owner). */
export interface Scope {
  storeId: string;
  ownerId: string;
}

/** Writes lock the store row and bump its draft revision (like every other draft change); every query is filtered by the store. */
export interface PostStore {
  list(storeId: string): Promise<Omit<PostRow, "body">[]>;
  get(storeId: string, id: string): Promise<PostRow | null>;
  /** "limit" = the store has the maximum number of posts. */
  create(s: Scope, input: PostInput, now: Date): Promise<PostRow | "limit">;
  update(s: Scope, id: string, input: PostInput, now: Date): Promise<PostRow | null>;
  remove(s: Scope, id: string): Promise<boolean>;
}
