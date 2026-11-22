import { describe, expect, it } from "vitest";
import { ROUTES } from "./contract.js";
import { buildOpenApi } from "./openapi.js";

const doc = buildOpenApi() as { openapi: string; paths: Record<string, Record<string, { security: unknown[]; responses: Record<string, unknown>; requestBody?: unknown; "x-permission"?: string; operationId: string }>> };

describe("OpenAPI document (phase 2.5)", () => {
  it("is OpenAPI 3.1 with one operation per contract route, under the v1 paths (health and readiness unversioned)", () => {
    expect(doc.openapi).toBe("3.1.0");
    const ops = Object.entries(doc.paths).flatMap(([p, m]) => Object.keys(m).map((k) => `${k.toUpperCase()} ${p}`));
    expect(ops).toHaveLength(ROUTES.length);
    expect(ops).toContain("GET /api/v1/admin/stores/{storeId}/products");
    expect(ops).toContain("POST /api/v1/auth/login");
    expect(ops).toContain("GET /api/v1/store/stores/{label}");
    expect(ops).toContain("GET /api/health");
    expect(ops.filter((o) => !o.includes("/api/v1/") && !/\/api\/(health|ready)$/.test(o))).toEqual([]);
  });
  it("operation ids are unique; store routes carry their permission; public routes need no session", () => {
    const all = Object.values(doc.paths).flatMap((m) => Object.values(m));
    expect(new Set(all.map((o) => o.operationId)).size).toBe(all.length);
    expect(doc.paths["/api/v1/admin/stores/{storeId}/secrets"]!.get!["x-permission"]).toBe("secrets.manage");
    expect(doc.paths["/api/v1/auth/login"]!.post!.security).toEqual([]);
    expect(doc.paths["/api/v1/admin/stores"]!.get!.security).toEqual([{ session: [] }]);
  });
  it("v1 operations document the error shape; secret values never appear in any response schema", () => {
    expect(Object.keys(doc.paths["/api/v1/admin/stores/{storeId}"]!.get!.responses)).toEqual(expect.arrayContaining(["200", "401", "403", "404", "500"]));
    const secrets = JSON.stringify(doc.paths["/api/v1/admin/stores/{storeId}/secrets"]!.get!.responses["200"]);
    expect(secrets).toContain("hint");
    expect(secrets).not.toMatch(/"value"/);
  });
  it("is deterministic (the committed file can be checked for drift)", () => {
    expect(JSON.stringify(buildOpenApi())).toBe(JSON.stringify(buildOpenApi()));
  });
  it("the list of routes without a response schema may only shrink", () => {
    expect(ROUTES.filter((r) => r.untyped).map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      "GET /api/ready",
      "GET /api/stores/:storeId/themes",
      "GET /api/stores/:storeId/themes/:key/report",
      "POST /api/stores/:storeId/categories/:categoryId/delete",
      "POST /api/stores/:storeId/logo",
      "POST /api/stores/:storeId/pages/:pageType/sections/:sectionId/image",
      "POST /api/stores/:storeId/products/:productId/image",
      "POST /api/stores/:storeId/themes/switch",
    ]);
  });
});
