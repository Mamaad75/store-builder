import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { StoreSuspensionConflictError } from "@store-builder/shared/modules/platform/errors";
import { StoreSuspendedError } from "@store-builder/shared/modules/access/errors";
import { send, UnauthenticatedError } from "./http";

const answer = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
afterEach(() => vi.unstubAllGlobals());

describe("browser client: domain errors from both answer shapes", () => {
  it("rebuilds v1 errors (the platform pages) with their own fields", async () => {
    answer(400, { error: { code: "VALIDATION_FAILED", message: "x", reason: "ValidationError", fieldErrors: { publicMessage: ["حداکثر 300 نویسه"] } }, requestId: "r" });
    const v = await send("POST", "/api/v1/platform/stores/s1/suspend", { body: {} }).catch((e: unknown) => e);
    expect(v).toBeInstanceOf(ValidationError);
    expect((v as ValidationError).fieldErrors).toEqual({ publicMessage: ["حداکثر 300 نویسه"] });

    answer(409, { error: { code: "CONFLICT", message: "x", reason: "StoreSuspensionConflictError", details: { reason: "not_suspended" } }, requestId: "r" });
    const c = await send("POST", "/api/v1/platform/stores/s1/restore", { body: {} }).catch((e: unknown) => e);
    expect(c).toBeInstanceOf(StoreSuspensionConflictError);
    expect((c as StoreSuspensionConflictError).reason).toBe("not_suspended");
  });

  it("still rebuilds the unversioned shape, and 401 in both shapes means signed out", async () => {
    answer(403, { statusCode: 403, error: "Forbidden", errorName: "StoreSuspendedError", payload: { code: "STORE_SUSPENDED" } });
    const s = await send("POST", "/api/stores/s1/publish").catch((e: unknown) => e);
    expect(s).toBeInstanceOf(StoreSuspendedError);
    answer(401, { error: { code: "UNAUTHENTICATED", message: "x", reason: "unauthenticated" }, requestId: "r" });
    await expect(send("GET", "/api/v1/platform/me")).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
