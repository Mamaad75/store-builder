import { createHash, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";

/** The merchant's order search on real PostgreSQL over HTTP: by number, by part of the mobile number, by part of the name; per store only. */
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
async function list(cookie: string, storeId: string, qs: string) {
  const r = await fetch(`${base}/api/stores/${storeId}/orders?${qs}`, { headers: { origin: PLATFORM, cookie } });
  return { status: r.status, json: (await r.json()) as { items: { number: number; address: { recipientName: string } }[]; nextCursor: string | null } };
}
let n = 0;
const order = (storeId: string, number: number, recipientName: string, phone: string, status: "PLACED" | "CONFIRMED" = "PLACED") =>
  prisma.order.create({
    data: {
      storeId, number, status, paymentMethod: "COD", requestKey: `s-${++n}-${randomBytes(6).toString("hex")}`,
      accessTokenHash: createHash("sha256").update(randomBytes(16)).digest("hex"),
      recipientName, phone, province: "tehran", city: "تهران", addressLine: "خیابان ولیعصر، پلاک ۸", postalCode: "1384567891",
      shippingName: "پیک", shippingKind: "FLAT", shippingCost: 0n, subtotal: 1000n, itemCount: 1, total: 1000n,
    },
  });
const numbers = (r: { json: { items: { number: number }[] } }) => r.json.items.map((i) => i.number).sort((a, b) => a - b);

describe("GET /stores/:id/orders?q=", () => {
  it("finds by order number, mobile fragment and name; Persian digits and # work; combined with the status filter", async () => {
    const owner = await makeUser();
    const store = await makeStore(owner.id);
    const cookie = await cookieOf(owner.id);
    await order(store.id, 1, "مریم احمدی", "+989121112222");
    await order(store.id, 2, "علی رضایی", "+989351112222", "CONFIRMED");
    await order(store.id, 128, "سارا کریمی", "+989129998877");

    expect(numbers(await list(cookie, store.id, "q=128"))).toEqual([128]);
    expect(numbers(await list(cookie, store.id, `q=${encodeURIComponent("#۱۲۸")}`))).toEqual([128]);
    expect(numbers(await list(cookie, store.id, "q=9121112222"))).toEqual([1]);
    expect(numbers(await list(cookie, store.id, "q=09121112222"))).toEqual([1]); // typed with the leading 0
    expect(numbers(await list(cookie, store.id, `q=${encodeURIComponent("۱۱۱۲۲۲۲")}`))).toEqual([1, 2]); // a fragment of two mobiles
    expect(numbers(await list(cookie, store.id, `q=${encodeURIComponent("احمدی")}`))).toEqual([1]);
    expect(numbers(await list(cookie, store.id, `q=${encodeURIComponent("علي")}`))).toEqual([2]); // an Arabic ya still finds the Persian name
    expect(numbers(await list(cookie, store.id, "q=1112222&status=CONFIRMED"))).toEqual([2]); // AND with the status
    expect(numbers(await list(cookie, store.id, "q=nothing-here"))).toEqual([]);
    expect(numbers(await list(cookie, store.id, "q="))).toEqual([1, 2, 128]); // an empty box is no filter
  });

  it("another store's orders never match, and the search pages with the cursor", async () => {
    const o1 = await makeUser();
    const o2 = await makeUser();
    const a = await makeStore(o1.id, "الف");
    const b = await makeStore(o2.id, "ب");
    for (let i = 1; i <= 4; i++) await order(a.id, i, "خریدار نمونه", `+98912000000${i}`);
    await order(b.id, 1, "خریدار نمونه", "+989120000001");
    const cookie = await cookieOf(o1.id);
    const first = await list(cookie, a.id, `q=${encodeURIComponent("خریدار")}&limit=3`);
    expect(first.json.items).toHaveLength(3);
    expect(first.json.nextCursor).not.toBeNull();
    const rest = await fetch(`${base}/api/stores/${a.id}/orders?q=${encodeURIComponent("خریدار")}&limit=3&before=${first.json.nextCursor}`, { headers: { origin: PLATFORM, cookie } });
    expect(((await rest.json()) as { items: unknown[] }).items).toHaveLength(1);
    expect(numbers(await list(await cookieOf(o2.id), b.id, "q=12000000"))).toEqual([1]); // b sees only its own
  });

  it("an over-long query is a 400, not a scan", async () => {
    const owner = await makeUser();
    const store = await makeStore(owner.id);
    expect((await list(await cookieOf(owner.id), store.id, `q=${"x".repeat(61)}`)).status).toBe(400);
  });
});
