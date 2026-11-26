import { postInputSchema } from "@store-builder/shared/modules/blog/blog";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { LIMIT_MESSAGE } from "../domain/post.js";
import type { PostStore, Scope } from "./ports.js";

const ID_RE = /^[a-z0-9]{1,64}$/;
const known = (id: string) => {
  if (!ID_RE.test(id)) throw new NotFoundError();
  return id;
};
function parse(body: unknown) {
  const r = postInputSchema.safeParse(body);
  if (r.success) return r.data;
  const out: Record<string, string[]> = {};
  for (const i of r.error.issues) (out[String(i.path[0] ?? "form")] ??= []).push(i.message);
  throw new ValidationError(out);
}

/** The merchant's blog posts of ONE store (the caller's, from the access guard). */
export class BlogService {
  constructor(
    private readonly posts: PostStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  list(a: Scope) {
    return this.posts.list(a.storeId);
  }

  async get(a: Scope, id: string) {
    const p = await this.posts.get(a.storeId, known(id));
    if (!p) throw new NotFoundError();
    return p;
  }

  async create(a: Scope, body: unknown) {
    const r = await this.posts.create({ storeId: a.storeId, ownerId: a.ownerId }, parse(body), this.clock());
    if (r === "limit") throw new ValidationError({ title: [LIMIT_MESSAGE] });
    return r;
  }

  async update(a: Scope, id: string, body: unknown) {
    const r = await this.posts.update({ storeId: a.storeId, ownerId: a.ownerId }, known(id), parse(body), this.clock());
    if (!r) throw new NotFoundError();
    return r;
  }

  async remove(a: Scope, id: string): Promise<void> {
    if (!(await this.posts.remove({ storeId: a.storeId, ownerId: a.ownerId }, known(id)))) throw new NotFoundError();
  }
}
