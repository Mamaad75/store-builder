import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { BlogService } from "./blog.service.js";
import type { PostRow, PostStore } from "./ports.js";

const NOW = new Date("2026-11-26T10:00:00Z");
const row: PostRow = { id: "p1", title: "عنوان", slug: "x", excerpt: "", body: "متن", status: "DRAFT", publishedAt: null, createdAt: NOW, updatedAt: NOW };
const A = { storeId: "s1", ownerId: "o1" };
const valid = { title: "عنوان مقاله", body: "متن کامل مقاله برای آزمون" };

function store(over: Partial<PostStore> = {}): PostStore & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    list: async (...a) => (calls.push(["list", ...a]), []),
    get: async (...a) => (calls.push(["get", ...a]), row),
    create: async (...a) => (calls.push(["create", a[0], a[1].title, a[2]]), row),
    update: async (...a) => (calls.push(["update", a[0], a[1], a[2].status, a[3]]), row),
    remove: async (...a) => (calls.push(["remove", ...a]), true),
    ...over,
  };
}

describe("BlogService", () => {
  it("validates first, then writes for the caller's store and owner with the service clock", async () => {
    const s = store();
    const svc = new BlogService(s, () => NOW);
    await expect(svc.create(A, { title: "ab", body: "x" })).rejects.toBeInstanceOf(ValidationError);
    expect(s.calls).toEqual([]);
    await svc.create(A, valid);
    await svc.update(A, "p1", { ...valid, status: "PUBLISHED" });
    await svc.remove(A, "p1");
    expect(s.calls).toEqual([["create", A, "عنوان مقاله", NOW], ["update", A, "p1", "PUBLISHED", NOW], ["remove", A, "p1"]]);
  });
  it("answers a limit as a field error, and a missing or malformed post as not found", async () => {
    await expect(new BlogService(store({ create: async () => "limit" })).create(A, valid)).rejects.toMatchObject({ fieldErrors: { title: [expect.stringContaining("حداکثر")] } });
    await expect(new BlogService(store({ get: async () => null })).get(A, "p1")).rejects.toBeInstanceOf(NotFoundError);
    await expect(new BlogService(store({ update: async () => null })).update(A, "p1", valid)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new BlogService(store({ remove: async () => false })).remove(A, "p1")).rejects.toBeInstanceOf(NotFoundError);
    await expect(new BlogService(store()).get(A, "../x")).rejects.toBeInstanceOf(NotFoundError);
  });
});
