import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { PublicReviewsService, StoreReviewsService } from "./reviews.service.js";
import type { ReviewRepository } from "./ports.js";

const NOW = new Date("2026-11-26T10:00:00Z");
function repo(over: Partial<ReviewRepository> = {}): ReviewRepository & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    activeProduct: async (...a) => (calls.push(["product", ...a]), { id: "p1", name: "چای" }),
    approved: async () => [],
    approvedTotals: async () => ({ count: 2, sum: 9 }),
    create: async (...a) => (calls.push(["create", ...a.slice(0, 5), a[5]]), "created"),
    list: async (...a) => (calls.push(["list", ...a]), []),
    setStatus: async (...a) => (calls.push(["status", ...a]), true),
    setReply: async (...a) => (calls.push(["reply", ...a]), true),
    ...over,
  };
}

describe("PublicReviewsService", () => {
  it("validates before touching the repository, then stores for the host's store and the session's customer", async () => {
    const r = repo();
    const svc = new PublicReviewsService(r, () => NOW);
    await expect(svc.submit("s1", "c1", { productSlug: "tea", rating: 9, body: "متن کافی است" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.submit("s1", "c1", { productSlug: "tea", rating: 4, body: "x" })).rejects.toBeInstanceOf(ValidationError);
    expect(r.calls).toEqual([]);
    await svc.submit("s1", "c1", { productSlug: "tea", rating: 4, body: "  نظر من‮ درباره چای  " });
    expect(r.calls[1]).toEqual(["create", "s1", "p1", "c1", 4, "نظر من درباره چای", NOW]);
  });

  it("maps the repository's refusals to Persian field errors and a missing product to not found", async () => {
    const input = { productSlug: "tea", rating: 5, body: "نظر کامل من" };
    await expect(new PublicReviewsService(repo({ create: async () => "duplicate" })).submit("s1", "c1", input)).rejects.toMatchObject({ fieldErrors: { body: [expect.stringContaining("قبلاً")] } });
    await expect(new PublicReviewsService(repo({ create: async () => "too_many_pending" })).submit("s1", "c1", input)).rejects.toMatchObject({ fieldErrors: { body: [expect.stringContaining("در انتظار تأیید")] } });
    await expect(new PublicReviewsService(repo({ create: async () => "no_customer" })).submit("s1", "c1", input)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PublicReviewsService(repo({ activeProduct: async () => null })).submit("s1", "c1", input)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PublicReviewsService(repo({ activeProduct: async () => null })).forProduct("s1", { product: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("summarises the approved ratings", async () => {
    expect((await new PublicReviewsService(repo()).forProduct("s1", { product: "tea" })).summary).toEqual({ count: 2, average: 4.5 });
  });
});

describe("StoreReviewsService", () => {
  it("scopes everything to the caller's store and treats an empty reply as removal", async () => {
    const r = repo();
    const svc = new StoreReviewsService(r, () => NOW);
    await svc.setStatus({ storeId: "s1" }, "abc", { status: "APPROVED" });
    await svc.reply({ storeId: "s1" }, "abc", { reply: "  " });
    await svc.reply({ storeId: "s1" }, "abc", { reply: "ممنون" });
    expect(r.calls).toEqual([["status", "s1", "abc", "APPROVED", NOW], ["reply", "s1", "abc", null, NOW], ["reply", "s1", "abc", "ممنون", NOW]]);
    await expect(svc.setStatus({ storeId: "s1" }, "abc", { status: "BOGUS" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.setStatus({ storeId: "s1" }, "../x", { status: "APPROVED" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new StoreReviewsService(repo({ setStatus: async () => false })).setStatus({ storeId: "s1" }, "abc", { status: "APPROVED" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.list({ storeId: "s1" }, { before: "nope" })).rejects.toBeInstanceOf(ValidationError);
  });
});
