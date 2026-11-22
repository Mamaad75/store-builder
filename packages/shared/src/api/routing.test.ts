import { describe, expect, it } from "vitest";
import { handlerPathOf, isV1Path, v1PathOf } from "./routing.js";

describe("v1 path mapping (phase 2.5)", () => {
  it("maps every scope both ways", () => {
    const pairs: [string, string][] = [
      ["/api/v1/auth/login", "/api/auth/login"],
      ["/api/v1/me/invitations", "/api/me/invitations"],
      ["/api/v1/me", "/api/me"],
      ["/api/v1/admin/stores", "/api/stores"],
      ["/api/v1/admin/stores/:storeId/products", "/api/stores/:storeId/products"],
      ["/api/v1/store/stores/:label", "/api/public/stores/:label"],
    ];
    for (const [v1, handler] of pairs) {
      expect(handlerPathOf(v1), v1).toBe(handler);
      expect(v1PathOf(handler), handler).toBe(v1);
    }
  });
  it("unknown, reserved and partial prefixes map to nothing (they answer 404)", () => {
    for (const p of ["/api/v1", "/api/v1/", "/api/v1/platform/x", "/api/v1/admin", "/api/v1/admin/other", "/api/v1/authx", "/api/v1/storex/a", "/api/v1/stores/1"]) expect(handlerPathOf(p), p).toBeNull();
    for (const p of ["/api/health", "/api/ready", "/api/storesx", "/api/publicx"]) expect(v1PathOf(p), p).toBeNull();
    expect(isV1Path("/api/v1/auth/login")).toBe(true);
    expect(isV1Path("/api/v1x")).toBe(false);
  });
});
