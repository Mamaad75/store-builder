import { slugify, uniqueSlug } from "@store-builder/shared/lib/text";
import type { PostInput } from "@store-builder/shared/modules/blog/blog";
import { db } from "../../../lib/db.js";
import { withStoreMutation } from "../../stores/stores.api.js";
import { canAddPost, publishedAtFor } from "../domain/post.js";
import type { PostRow, PostStore, Scope } from "../application/ports.js";

// The only file of the blog module that reaches the database. Writes go through the store mutation (store row locked, draft revision bumped).

const select = { id: true, title: true, slug: true, excerpt: true, body: true, status: true, publishedAt: true, createdAt: true, updatedAt: true } as const;
const SLUG_BASE_MAX = 100;

export class PrismaBlogRepository implements PostStore {
  async list(storeId: string) {
    // the text is not selected: a list never carries up to 50 articles
    const { body: _text, ...summary } = select;
    void _text;
    return db.blogPost.findMany({ where: { storeId }, select: summary, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  }

  get(storeId: string, id: string): Promise<PostRow | null> {
    return db.blogPost.findFirst({ where: { id, storeId }, select });
  }

  create(s: Scope, input: PostInput, now: Date): Promise<PostRow | "limit"> {
    return withStoreMutation(s.ownerId, s.storeId, async ({ tx }) => {
      if (!canAddPost(await tx.blogPost.count({ where: { storeId: s.storeId } }))) return "limit" as const;
      const base = slugify(input.title, "post").slice(0, SLUG_BASE_MAX);
      const taken = new Set((await tx.blogPost.findMany({ where: { storeId: s.storeId, slug: { startsWith: base } }, select: { slug: true } })).map((r) => r.slug));
      return tx.blogPost.create({
        data: { storeId: s.storeId, title: input.title, slug: uniqueSlug(base, taken), excerpt: input.excerpt, body: input.body, status: input.status, publishedAt: publishedAtFor(input.status, null, now) },
        select,
      });
    });
  }

  update(s: Scope, id: string, input: PostInput, now: Date): Promise<PostRow | null> {
    return withStoreMutation(s.ownerId, s.storeId, async ({ tx }) => {
      const cur = await tx.blogPost.findFirst({ where: { id, storeId: s.storeId }, select: { publishedAt: true } });
      if (!cur) return null;
      return tx.blogPost.update({
        where: { id },
        data: { title: input.title, excerpt: input.excerpt, body: input.body, status: input.status, publishedAt: publishedAtFor(input.status, cur.publishedAt, now) },
        select,
      });
    });
  }

  remove(s: Scope, id: string): Promise<boolean> {
    return withStoreMutation(s.ownerId, s.storeId, async ({ tx }) => (await tx.blogPost.deleteMany({ where: { id, storeId: s.storeId } })).count === 1);
  }
}
