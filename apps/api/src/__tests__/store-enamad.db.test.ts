import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../app.js";
import { TokenService } from "../auth/token.js";
import { createStore } from "../modules/stores/service.js";
import { listenFetchable, testConfig } from "./helpers.js";
import { makeUser, prisma, resetDb } from "../test/db-helpers.js";

/** The eNamad seal in the store settings, on real PostgreSQL over HTTP: saved as id and code only, removable, shown in the draft data, never markup. */
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

async function setup() {
  const owner = await makeUser();
  const { id } = await createStore(owner.id, { name: "فروشگاه اینماد", templateKey: "bazaar" });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  const cookie = `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}/api${path}`, { method, headers: { origin: PLATFORM, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text();
    return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
  };
  return { id, call };
}
const OK = { id: "123456", code: "AbCdEfGh12345678" };

describe("eNamad in store settings", () => {
  it("saves only the id and code; the draft storefront data carries them; removing returns the data to what it was", async () => {
    const { id, call } = await setup();
    const before = (await call("GET", `/stores/${id}/preview`)).json.data.store;
    expect("enamad" in before).toBe(false); // a store without a seal publishes byte-for-byte what it did before

    const saved = await call("PATCH", `/stores/${id}`, { enamad: OK });
    expect(saved.status).toBe(200);
    expect(saved.json.settings.enamad).toEqual(OK);
    expect((await call("GET", `/stores/${id}/preview`)).json.data.store.enamad).toEqual(OK);

    // saving other settings keeps the seal; saving nothing new changes nothing
    expect((await call("PATCH", `/stores/${id}`, { description: "فروشگاه معتبر" })).json.settings.enamad).toEqual(OK);

    const removed = await call("PATCH", `/stores/${id}`, { enamad: null });
    expect(removed.status).toBe(200);
    expect(removed.json.settings.enamad).toBeNull();
    const after = (await call("GET", `/stores/${id}/preview`)).json.data.store;
    expect(after).toEqual({ ...before, description: "فروشگاه معتبر" }); // exactly the data without a seal (plus the description saved in between)
    expect("enamad" in after).toBe(false);
  });

  it("refuses anything that is not an id and a code: markup, other hosts, wrong shapes, extra keys", async () => {
    const { id, call } = await setup();
    const bad = [
      { id: "12 3", code: OK.code },
      { id: "<script>", code: OK.code },
      { id: OK.id, code: 'x"onerror=alert(1)//' },
      { id: OK.id, code: "short" },
      { id: OK.id, code: OK.code, href: "https://evil.example" },
      { id: OK.id, code: OK.code, html: "<img src=x onerror=alert(1)>" },
      "https://evil.example",
      { id: 123456, code: OK.code },
    ];
    for (const e of bad) expect((await call("PATCH", `/stores/${id}`, { enamad: e })).status, JSON.stringify(e)).toBe(400);
    expect((await call("GET", `/stores/${id}`)).json.settings.enamad).toBeNull(); // nothing was stored
  });

  it("the change is audited like any settings change", async () => {
    const { id, call } = await setup();
    await call("PATCH", `/stores/${id}`, { enamad: OK });
    await expect.poll(() => prisma.auditEvent.count({ where: { storeId: id, action: "store.settings_updated" } })).toBeGreaterThanOrEqual(1);
  });
});
