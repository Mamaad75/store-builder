import { readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterEach, describe, expect, it } from "vitest";
import { ROUTES } from "@store-builder/shared/api/contract";
import { buildOpenApi } from "@store-builder/shared/api/openapi";
import { apiErrorV1 } from "@store-builder/shared/api/schemas";
import { createApp } from "../app.js";
import { apiVersionMiddleware } from "../http/api-version.js";
import { capture, fakeDb, listenFetchable, testConfig } from "./helpers.js";
import { MemoryRateLimiter, MemoryUsers } from "./memory.js";
import { registeredRoutes } from "./routes.js";

let app: NestExpressApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function boot() {
  const cap = capture();
  const started = await listenFetchable(() => createApp(testConfig, { database: fakeDb(), logger: cap.logger, users: new MemoryUsers(), rateLimiter: new MemoryRateLimiter() }));
  app = started.app;
  return started.base;
}

describe("API contract (phase 2.5): documented = served", () => {
  it("every registered route is in the contract with the same permission and success status, and nothing else is", async () => {
    await boot();
    const served = registeredRoutes(app!).map((r) => `${r.method} ${r.path} ${r.permission ?? "-"} ${r.status ?? (r.method === "POST" ? 201 : 200)}`);
    const documented = ROUTES.map((r) => `${r.method} ${r.path} ${r.permission ?? "-"} ${r.status}`);
    expect(served.sort()).toEqual([...documented].sort());
    expect(served.length).toBeGreaterThanOrEqual(81);
  });

  it("phase 3.1: every platform route really carries SessionGuard + PlatformAdminGuard, and nothing else does", async () => {
    await boot();
    for (const r of registeredRoutes(app!)) {
      const isPlatform = r.path.startsWith("/api/platform/");
      expect(r.guards.includes("PlatformAdminGuard"), `${r.method} ${r.path}`).toBe(isPlatform);
      if (isPlatform) expect(r.guards.indexOf("SessionGuard"), r.path).toBe(0);
    }
  });

  it("store routes are documented as session routes with a permission; only the storefront, sign-in/up and operations are public", () => {
    for (const r of ROUTES) {
      if (r.path.startsWith("/api/platform/")) expect(r.platform && r.auth === "session", r.path).toBe(true);
      if (r.path.includes(":storeId")) expect(r.permission, r.path).toBeDefined();
      if (r.auth === "public") expect(r.path, `${r.method} ${r.path}`).toMatch(/^\/api\/(public\/|health$|ready$|auth\/(login|register|registration|recover)$)/); // MVP item 2 adds the sign-up mode and the recovery link
    }
  });

  it("docs/api/openapi.json is the generated document (run `pnpm --filter @store-builder/api openapi` after changing the contract)", () => {
    const committed = readFileSync(join(import.meta.dirname, "../../../../docs/api/openapi.json"), "utf8");
    expect(committed).toBe(`${JSON.stringify(buildOpenApi(), null, 2)}\n`);
  });
});

describe("/api/v1 routing and errors (phase 2.5)", () => {
  it("a v1 path reaches the same handler; the unversioned path still works and is marked deprecated with its successor", async () => {
    const url = await boot();
    const v1 = await fetch(`${url}/api/v1/auth/me`);
    expect(v1.status).toBe(401);
    expect(v1.headers.get("deprecation")).toBeNull();
    const legacy = await fetch(`${url}/api/auth/me`);
    expect(legacy.status).toBe(401);
    expect(legacy.headers.get("deprecation")).toBe("true");
    expect(legacy.headers.get("link")).toBe('</api/v1/auth/me>; rel="successor-version"');
    expect((await fetch(`${url}/api/health`)).headers.get("deprecation")).toBeNull(); // operations are not versioned
  });

  it("v1 errors have one shape: fixed code and Persian message, the request id, never internals", async () => {
    const url = await boot();
    const r = await fetch(`${url}/api/v1/auth/me`, { headers: { "x-request-id": "trace-v1-000001" } });
    const body = (await r.json()) as any;
    expect(apiErrorV1.safeParse(body).success).toBe(true);
    expect(body).toEqual({ error: { code: "UNAUTHENTICATED", message: "ابتدا وارد حساب کاربری خود شوید.", reason: "unauthenticated" }, requestId: "trace-v1-000001" });
    // the deprecated path keeps the shape the web app reads
    expect(await (await fetch(`${url}/api/auth/me`)).json()).toEqual({ statusCode: 401, error: "Unauthorized", code: "unauthenticated" });
  });

  it("validation errors keep their field messages in v1", async () => {
    const url = await boot();
    const r = await fetch(`${url}/api/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ name: "", username: "x", password: "1" }) });
    const body = (await r.json()) as any;
    expect(apiErrorV1.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(body.error.fieldErrors ?? {})).toEqual(expect.arrayContaining(["username", "password"]));
  });

  it("unknown scopes and partial prefixes answer 404 in the v1 shape; the platform scope needs a session", async () => {
    const url = await boot();
    expect((await fetch(`${url}/api/v1/platform/overview`)).status).toBe(401);
    for (const p of ["/api/v1/platform", "/api/v1/nothing", "/api/v1", "/api/v1/admin", "/api/v1/admin/other"]) {
      const r = await fetch(`${url}${p}`);
      expect(r.status, p).toBe(404);
      expect(((await r.json()) as any).error?.code, p).toBe("NOT_FOUND");
    }
  });

  it("the Origin check applies to v1 writes exactly as to the old paths", async () => {
    const url = await boot();
    const r = await fetch(`${url}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ username: "a", password: "b" }) });
    expect(r.status).toBe(403);
    expect(((await r.json()) as any).error.code).toBe("FORBIDDEN");
  });

  it("the rewrite keeps the query string and touches nothing outside /api/v1", () => {
    const run = (url: string) => {
      const req = { url } as never as Parameters<typeof apiVersionMiddleware>[0];
      const headers: Record<string, string> = {};
      const res = { locals: {} as Record<string, unknown>, setHeader: (k: string, v: string) => void (headers[k] = v) } as never as Parameters<typeof apiVersionMiddleware>[1];
      apiVersionMiddleware(req, res, () => undefined);
      return { url: (req as { url: string }).url, v1: (res as { locals: { apiVersion?: number } }).locals.apiVersion === 1, headers };
    };
    expect(run("/api/v1/admin/stores/s1/products?limit=5&cursor=abc")).toEqual({ url: "/api/stores/s1/products?limit=5&cursor=abc", v1: true, headers: {} });
    expect(run("/api/v1/nothing/x?y=1")).toEqual({ url: "/api/v1/nothing/x?y=1", v1: true, headers: {} });
    expect(run("/api/v1/platform/overview").url).toBe("/api/platform/overview");
    expect(run("/api/stores?x=1").headers).toEqual({ Deprecation: "true", Link: '</api/v1/admin/stores>; rel="successor-version"' });
    expect(run("/api/health")).toEqual({ url: "/api/health", v1: false, headers: {} });
    expect(run("/other/api/v1/auth")).toEqual({ url: "/other/api/v1/auth", v1: false, headers: {} });
  });
  it("security review 2026-11-22: encoded slashes, dot segments, case and doubled slashes never reach another handler", async () => {
    const url = new URL(await boot());
    // Raw requests: fetch() would normalise dot segments before sending.
    const raw = (path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const rq = request({ host: url.hostname, port: url.port, path, method: "GET" }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        rq.on("error", reject);
        rq.end();
      });
    for (const p of ["/api/v1/store/..%2F..%2Fhealth", "/api/v1/store/../../health", "/api/v1/store/../me/invitations", "/API/V1/auth/me", "/api/v1//me/invitations", "/api/v1/admin/stores/..%2F..%2Fme/invitations"]) {
      const r = await raw(p);
      expect(r.status, p).toBe(404);
      expect(r.body, p).not.toContain("\"status\":\"ok\"");
    }
  });
});
