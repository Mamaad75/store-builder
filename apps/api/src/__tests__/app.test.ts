import { Controller, Post } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../app.js";
import { capture, fakeDb, testConfig } from "./helpers.js";

@Controller("probe")
class ProbeController {
  @Post()
  write() {
    return { ok: true };
  }
}

let app: NestExpressApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function boot(ok = true, production = false) {
  const cap = capture();
  app = await createApp({ ...testConfig, production }, { database: fakeDb(ok), logger: cap.logger, extraControllers: [ProbeController] });
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  return { url: url.replace("[::1]", "127.0.0.1"), cap };
}

describe("health and readiness", () => {
  it("liveness answers ok without touching the database", async () => {
    const { url } = await boot(false);
    const r = await fetch(`${url}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("readiness is 200 when the database answers", async () => {
    const { url } = await boot(true);
    const r = await fetch(`${url}/api/ready`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ready", checks: { database: "ok" } });
  });
  it("readiness is 503 and leaks nothing when the database fails", async () => {
    const { url } = await boot(false);
    const r = await fetch(`${url}/api/ready`);
    const text = await r.text();
    expect(r.status).toBe(503);
    expect(text).not.toContain("secret-host");
    expect(JSON.parse(text).checks.database).toBe("fail");
  });
  it("shares one probe between concurrent callers", async () => {
    const cap = capture();
    const db = fakeDb(true);
    app = await createApp(testConfig, { database: db, logger: cap.logger });
    await app.listen(0, "127.0.0.1");
    const url = (await app.getUrl()).replace("[::1]", "127.0.0.1");
    await Promise.all(Array.from({ length: 10 }, () => fetch(`${url}/api/ready`)));
    expect(db.pings).toBe(1);
  });
});

describe("security headers and errors", () => {
  it("sets restrictive headers and hides the framework", async () => {
    const { url } = await boot();
    const r = await fetch(`${url}/api/health`);
    expect(r.headers.get("x-powered-by")).toBeNull();
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("content-security-policy")).not.toContain("unsafe-inline");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("strict-transport-security")).toBeNull();
  });
  it("sends HSTS in production", async () => {
    const { url } = await boot(true, true);
    expect((await fetch(`${url}/api/health`)).headers.get("strict-transport-security")).toContain("max-age=63072000");
  });
  it("unknown routes return the fixed error body", async () => {
    const { url } = await boot();
    const r = await fetch(`${url}/api/nope`);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ statusCode: 404, error: "Not Found" });
  });
});

describe("origin guard (CSRF)", () => {
  const post = (url: string, headers: Record<string, string> = {}) => fetch(`${url}/api/probe`, { method: "POST", headers });
  it("refuses a state-changing request without an Origin", async () => {
    const { url } = await boot();
    expect((await post(url)).status).toBe(403);
  });
  it("refuses a foreign or null Origin", async () => {
    const { url } = await boot();
    expect((await post(url, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(url, { origin: "null" })).status).toBe(403);
  });
  it("refuses cross-site fetch metadata even with a matching Origin", async () => {
    const { url } = await boot();
    expect((await post(url, { origin: "http://localhost:3000", "sec-fetch-site": "cross-site" })).status).toBe(403);
  });
  it("lets an allowed Origin through the guard (the route then answers)", async () => {
    const { url } = await boot();
    expect((await post(url, { origin: "http://localhost:3000" })).status).toBe(201);
  });
  it("never blocks safe methods", async () => {
    const { url } = await boot();
    expect((await fetch(`${url}/api/health`, { headers: { origin: "https://evil.example" } })).status).toBe(200);
  });
});

describe("request body", () => {
  it("rejects oversized bodies with 413 and the fixed body", async () => {
    const { url } = await boot();
    const r = await fetch(`${url}/api/probe`, {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ a: "x".repeat(200_000) }),
    });
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ statusCode: 413, error: "Payload Too Large" });
  });
});
