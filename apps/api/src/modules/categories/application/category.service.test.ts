import { beforeEach, describe, expect, it } from "vitest";
import { MAX_CATEGORIES_PER_STORE } from "@store-builder/shared/modules/categories/schemas";
import { CatalogLimitError, CategoryNotEmptyError, NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { CategoryService } from "./category.service.js";
import {
  DuplicateKeyError,
  StillReferencedError,
  type CategoryReader,
  type CategoryUnitOfWork,
  type CategoryView,
  type CategoryWrites,
  type StoreOwnership,
} from "./ports.js";

interface Row extends CategoryView {
  storeId: string;
}

/**
 * In-memory ports with the same contract as the PostgreSQL adapters: owner-scoped reads, and a unit of work that works on a copy
 * and commits only when `work` succeeds (rollback), counting commits as the draftRevision bump.
 */
class Memory implements CategoryReader, CategoryUnitOfWork, StoreOwnership {
  rows: Row[] = [];
  products = new Map<string, number>(); // categoryId -> product count
  commits = 0;
  runs = 0;
  failNextRunWith: unknown = null;
  private seq = 0;
  constructor(private readonly owners: Record<string, string>) {}

  async assertOwned(ownerId: string, storeId: string) {
    if (this.owners[storeId] !== ownerId) throw new NotFoundError();
  }
  async list(ownerId: string, storeId: string) {
    return this.owners[storeId] === ownerId ? this.rows.filter((r) => r.storeId === storeId) : [];
  }
  async find(ownerId: string, storeId: string, id: string) {
    return (await this.list(ownerId, storeId)).find((r) => r.id === id) ?? null;
  }
  async run<T>(ownerId: string, storeId: string, work: (w: CategoryWrites) => Promise<T>): Promise<T> {
    this.runs += 1;
    await this.assertOwned(ownerId, storeId);
    let draft = this.rows.map((r) => ({ ...r }));
    const products = new Map(this.products);
    const mine = () => draft.filter((r) => r.storeId === storeId);
    const writes: CategoryWrites = {
      count: async () => mine().length,
      list: async () => mine(),
      find: async (id) => mine().find((r) => r.id === id) ?? null,
      insert: async ({ name, slug }) => {
        const id = `c${++this.seq}`;
        draft.push({ id, name, slug, storeId, createdAt: new Date(0), _count: { products: 0 } });
        return { id };
      },
      rename: async (id, name) => {
        const r = mine().find((x) => x.id === id);
        if (r) r.name = name;
        return Boolean(r);
      },
      lock: async (id) => mine().some((r) => r.id === id),
      countProducts: async (id) => products.get(id) ?? 0,
      detachProducts: async (id) => {
        const n = products.get(id) ?? 0;
        products.delete(id);
        return n;
      },
      delete: async (id) => {
        const before = draft.length;
        draft = draft.filter((r) => !(r.id === id && r.storeId === storeId));
        return draft.length === before - 1;
      },
    };
    const result = await work(writes);
    if (this.failNextRunWith) {
      const e = this.failNextRunWith;
      this.failNextRunWith = null;
      throw e; // the database refused the commit: nothing below is applied
    }
    this.rows = draft;
    this.products = products;
    this.commits += 1;
    return result;
  }
}

let mem: Memory;
let svc: CategoryService;
beforeEach(() => {
  mem = new Memory({ s1: "alice", s2: "bob" });
  svc = new CategoryService(mem, mem, mem);
});

describe("CategoryService (application layer, in-memory ports)", () => {
  it("creates a category with a normalised slug inside one unit of work", async () => {
    const { id } = await svc.create("alice", "s1", { name: "  نوشیدنی  گرم " });
    expect(await svc.list("alice", "s1")).toMatchObject([{ id, name: "نوشیدنی گرم", slug: "نوشیدنی-گرم" }]);
    expect(mem.commits).toBe(1);
  });

  it("validates input before opening a unit of work (bad name, malformed or foreign store)", async () => {
    await expect(svc.create("alice", "s1", { name: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create("alice", "", { name: "چای" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.create("alice", "x".repeat(65), { name: "چای" })).rejects.toBeInstanceOf(NotFoundError);
    expect(mem.runs).toBe(0);
    await expect(svc.create("alice", "s2", { name: "چای" })).rejects.toBeInstanceOf(NotFoundError); // ownership: in the unit of work
    await expect(svc.list("alice", "s2")).rejects.toBeInstanceOf(NotFoundError);
    expect(mem.commits).toBe(0);
  });

  it("refuses duplicates and the category limit without committing", async () => {
    await svc.create("alice", "s1", { name: "چای" });
    await expect(svc.create("alice", "s1", { name: "چاي" })).rejects.toBeInstanceOf(ValidationError);
    for (let i = 1; i < MAX_CATEGORIES_PER_STORE; i++) await svc.create("alice", "s1", { name: `دسته ${i}` });
    await expect(svc.create("alice", "s1", { name: "یکی بیشتر" })).rejects.toBeInstanceOf(CatalogLimitError);
    expect(mem.commits).toBe(MAX_CATEGORIES_PER_STORE);
  });

  it("turns a duplicate the database caught (concurrent insert) into the user-facing validation error", async () => {
    mem.failNextRunWith = new DuplicateKeyError("name");
    const err = await svc.create("alice", "s1", { name: "چای" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors).toHaveProperty("name");
    expect(await svc.list("alice", "s1")).toEqual([]); // rolled back
  });

  it("a rename to the same name writes nothing; a real rename keeps the slug", async () => {
    const { id } = await svc.create("alice", "s1", { name: "چای" });
    await svc.update("alice", "s1", id, { name: "چای" });
    expect(mem.runs).toBe(1);
    await svc.update("alice", "s1", id, { name: "دمنوش" });
    expect(await svc.list("alice", "s1")).toMatchObject([{ id, name: "دمنوش", slug: "چای" }]);
  });

  it("rename: unknown or foreign category is NotFound, a clash with another category is a validation error", async () => {
    const { id } = await svc.create("alice", "s1", { name: "چای" });
    await svc.create("alice", "s1", { name: "قهوه" });
    await expect(svc.update("alice", "s1", "nope", { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.update("bob", "s1", id, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.update("alice", "s1", id, { name: "قهوه" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("delete refuses a category with products unless they are moved, and reports how many moved", async () => {
    const { id } = await svc.create("alice", "s1", { name: "چای" });
    mem.products.set(id, 3);
    const err = await svc.delete("alice", "s1", id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CategoryNotEmptyError);
    expect((err as CategoryNotEmptyError).productCount).toBe(3);
    expect(await svc.list("alice", "s1")).toHaveLength(1);
    expect(await svc.delete("alice", "s1", id, { moveProducts: true })).toEqual({ movedProducts: 3 });
    expect(await svc.list("alice", "s1")).toEqual([]);
  });

  it("delete: invalid options are rejected; a product attached concurrently (foreign key) is reported as not empty", async () => {
    const { id } = await svc.create("alice", "s1", { name: "چای" });
    await expect(svc.delete("alice", "s1", id, { moveProducts: "yes" })).rejects.toBeInstanceOf(ValidationError);
    mem.failNextRunWith = new StillReferencedError();
    const err = await svc.delete("alice", "s1", id).catch((e: unknown) => e);
    expect((err as CategoryNotEmptyError).productCount).toBe(-1);
    await expect(svc.delete("alice", "s1", "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});
