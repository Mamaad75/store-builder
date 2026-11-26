import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { StaffSupportService, SupportService } from "./support.service.js";
import type { TicketRepository, TicketRow } from "./ports.js";

const NOW = new Date("2026-11-26T10:00:00Z");
const row = (o: Partial<TicketRow> = {}): TicketRow => ({ id: "t1", storeId: "s1", subject: "x", status: "OPEN", messageCount: 1, lastMessageAt: NOW, createdAt: NOW, ...o });

function repo(over: Partial<TicketRepository> = {}): TicketRepository & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    listForStore: async (...a) => (calls.push(["list", ...a]), []),
    listForStaff: async (f) => (calls.push(["staff", f]), []),
    create: async (...a) => (calls.push(["create", ...a]), row()),
    detail: async () => null,
    addMessage: async (...a) => (calls.push(["add", a[0], a[1], a[2]]), row()),
    setStatus: async (...a) => (calls.push(["status", a[0], a[1], a[2]]), row()),
    ...over,
  };
}

describe("SupportService (merchant)", () => {
  it("validates before touching the repository and scopes every call to the caller's store", async () => {
    const r = repo();
    const svc = new SupportService(r, () => NOW);
    await expect(svc.open({ storeId: "s1", actorId: "u1" }, { subject: "ab", body: "x" })).rejects.toBeInstanceOf(ValidationError);
    expect(r.calls).toEqual([]);
    await svc.open({ storeId: "s1", actorId: "u1" }, { subject: "موضوع تست", body: "متن پیام تست" });
    expect(r.calls[0]).toEqual(["create", "s1", "u1", "موضوع تست", "متن پیام تست", NOW]);
    await svc.reply({ storeId: "s1", actorId: "u1" }, "abc", { body: "پاسخ من" });
    expect(r.calls[1]).toMatchObject(["add", "abc", "s1", { from: "SELLER", authorId: "u1" }]);
  });

  it("answers a limit, a missing ticket and a malformed id in the right way", async () => {
    const full = new SupportService(repo({ create: async () => "too_many_open" }));
    await expect(full.open({ storeId: "s1", actorId: "u1" }, { subject: "موضوع تست", body: "متن پیام تست" })).rejects.toMatchObject({ fieldErrors: { subject: [expect.stringContaining("درخواست باز")] } });
    const none = new SupportService(repo({ addMessage: async () => "not_found" }));
    await expect(none.reply({ storeId: "s1", actorId: "u1" }, "abc", { body: "پاسخ من" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(none.get({ storeId: "s1" }, "../etc")).rejects.toBeInstanceOf(NotFoundError);
    const closeMissing = new SupportService(repo({ setStatus: async () => null }));
    await expect(closeMissing.close({ storeId: "s1" }, "abc")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("StaffSupportService", () => {
  it("passes a bounded list query, and an audit record with the staff member (no message text)", async () => {
    const r = repo();
    const svc = new StaffSupportService(r, () => NOW);
    await svc.list({ status: "OPEN", limit: "20" });
    expect(r.calls[0]).toEqual(["staff", { status: "OPEN", before: undefined, limit: 20 }]);
    await expect(svc.list({ limit: "1000" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.list({ before: "not-a-date" })).rejects.toBeInstanceOf(ValidationError);
    let seen: unknown;
    const spy = new StaffSupportService(repo({ addMessage: async (...a) => ((seen = a[5]), row()) }), () => NOW);
    await spy.reply("staff1", "abc", { body: "پاسخ پشتیبانی" });
    expect(seen).toEqual({ actorId: "staff1", action: "platform.ticket_replied", targetId: "abc", metadata: {} });
  });
});
