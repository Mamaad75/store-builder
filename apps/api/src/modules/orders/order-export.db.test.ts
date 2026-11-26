import { createHash, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";

/** The orders CSV on real PostgreSQL over HTTP: headers, filters, per-store, roles, audit, and no formula injection. */
const PLATFORM = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const sessions = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);

let app: NestExpressApplication | undefined;
let base = "";
beforeEach(async () => {
  await resetDb();
  ({ app, base } = await listenFetchable(() => createApp(config)));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => prisma.$disconnect());

const cookieOf = async (userId: string) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}`;
};
async function exportCsv(cookie: string, storeId: string, qs = "") {
  const r = await fetch(`${base}/api/stores/${storeId}/orders/export${qs ? `?${qs}` : ""}`, { headers: { origin: PLATFORM, cookie } });
  const bytes = new Uint8Array(await r.arrayBuffer());
  // fetch's text() drops a leading UTF-8 byte-order mark, so the BOM is checked on the raw bytes and put back for the string checks
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return { status: r.status, type: r.headers.get("content-type") ?? "", disposition: r.headers.get("content-disposition") ?? "", cache: r.headers.get("cache-control") ?? "", bom, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) };
}
let n = 0;
const order = (storeId: string, number: number, o: { name?: string; phone?: string; status?: "PLACED" | "CONFIRMED"; createdAt?: Date; note?: string } = {}) =>
  prisma.order.create({
    data: {
      storeId, number, status: o.status ?? "PLACED", paymentMethod: "COD", createdAt: o.createdAt ?? new Date(), requestKey: `x-${++n}-${randomBytes(6).toString("hex")}`,
      accessTokenHash: createHash("sha256").update(randomBytes(16)).digest("hex"),
      recipientName: o.name ?? "مریم احمدی", phone: o.phone ?? "+989121234567", province: "tehran", city: "تهران", addressLine: "خیابان ولیعصر", postalCode: "1384567891",
      shippingName: "پیک", shippingKind: "FLAT", shippingCost: 30_000n, subtotal: 120_000n, itemCount: 1, total: 150_000n, note: o.note ?? "",
    },
  });
const dataRows = (csv: string) => csv.replace(/^\uFEFF/, "").split("\r\n").slice(1).filter(Boolean);
const days = (d: number) => new Date(Date.now() - d * 86_400_000);

describe("GET /stores/:id/orders/export", () => {
  it("is a UTF-8 CSV download with the header and one row per order, newest first; 'export' is not read as an order id", async () => {
    const owner = await makeUser();
    const store = await makeStore(owner.id);
    await order(store.id, 1, { name: "علی رضایی", phone: "+989351112222" });
    await order(store.id, 2);
    const r = await exportCsv(await cookieOf(owner.id), store.id);
    expect(r.status).toBe(200);
    expect(r.type).toContain("text/csv");
    expect(r.disposition).toMatch(/^attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(r.cache).toBe("no-store");
    expect(r.bom).toBe(true); // Excel needs the byte-order mark to read Persian
    expect(r.text.startsWith("\uFEFF")).toBe(true);
    const rows = dataRows(r.text);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.startsWith("2,")).toBe(true); // newest (highest number) first
    expect(rows[1]).toContain("علی رضایی");
    expect(rows[1]).toContain("09351112222"); // 09…, never +98…
    expect(r.text).not.toContain("+98");
  });

  it("filters: status, search and the last N days; only this store's orders", async () => {
    const o1 = await makeUser();
    const o2 = await makeUser();
    const a = await makeStore(o1.id, "الف");
    const b = await makeStore(o2.id, "ب");
    await order(a.id, 1, { name: "قدیمی", createdAt: days(40) });
    await order(a.id, 2, { name: "اخیر", createdAt: days(2), status: "CONFIRMED" });
    await order(a.id, 3, { name: "امروز", createdAt: days(0) });
    await order(b.id, 1, { name: "فروشگاه دیگر" });
    const c = await cookieOf(o1.id);
    expect(dataRows((await exportCsv(c, a.id)).text)).toHaveLength(3);
    expect(dataRows((await exportCsv(c, a.id, "days=30")).text)).toHaveLength(2); // the 40-day-old one is out
    expect(dataRows((await exportCsv(c, a.id, "days=7")).text)).toHaveLength(2);
    expect(dataRows((await exportCsv(c, a.id, "status=CONFIRMED")).text)).toHaveLength(1);
    expect(dataRows((await exportCsv(c, a.id, `q=${encodeURIComponent("اخیر")}`)).text)).toHaveLength(1);
    expect((await exportCsv(c, a.id)).text).not.toContain("فروشگاه دیگر");
    expect((await exportCsv(c, a.id, "days=5")).status).toBe(400);
    expect((await exportCsv(c, a.id, "limit=1")).status).toBe(400);
  });

  it("a hostile buyer's text cannot become a spreadsheet formula", async () => {
    const owner = await makeUser();
    const store = await makeStore(owner.id);
    await order(store.id, 1, { name: "=HYPERLINK(\"http://evil\",\"x\")", note: "@SUM(1+1)" });
    const row = dataRows((await exportCsv(await cookieOf(owner.id), store.id)).text)[0]!;
    expect(row).toContain("\"'=HYPERLINK");
    expect(row).toContain("'@SUM");
  });

  it("owner and manager may; an operator may not; a stranger gets 404; every export is audited", async () => {
    const owner = await makeUser();
    const manager = await makeUser();
    const operator = await makeUser();
    const stranger = await makeUser();
    const store = await makeStore(owner.id);
    await prisma.storeMember.createMany({ data: [{ storeId: store.id, userId: manager.id, role: "MANAGER" }, { storeId: store.id, userId: operator.id, role: "OPERATOR" }] });
    await order(store.id, 1);
    expect((await exportCsv(await cookieOf(owner.id), store.id)).status).toBe(200);
    expect((await exportCsv(await cookieOf(manager.id), store.id)).status).toBe(200);
    expect((await exportCsv(await cookieOf(operator.id), store.id)).status).toBe(403);
    expect((await exportCsv(await cookieOf(stranger.id), store.id)).status).toBe(404);
    expect((await exportCsv("", store.id)).status).toBe(401);
    const audits = await prisma.auditEvent.findMany({ where: { storeId: store.id, action: "order.exported" }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => a.actorId)).toEqual([owner.id, manager.id]); // who exported, and only successful exports
  });
});
