import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "0123456789abcdef0123456789abcdef";

afterEach(() => vi.resetModules());

describe("web error tracking (phase 2.6)", () => {
  it("is off without a DSN and refuses an invalid configuration, naming variables only", async () => {
    const { initErrorTracking } = await import("./error-tracking");
    expect(initErrorTracking({ NODE_ENV: "production" })).toEqual([]);
    const problems = initErrorTracking({ NODE_ENV: "production", ERROR_TRACKING_DSN: `http://${KEY}@errors.example.ir/3`, APP_RELEASE: "v 1" });
    expect(problems.map((p) => p.split(":")[0])).toEqual(["ERROR_TRACKING_DSN", "APP_RELEASE"]);
    expect(JSON.stringify(problems)).not.toContain(KEY);
  });

  it("reports a server error with the route template and method only; Next's navigation signals are not errors", async () => {
    const { initErrorTracking, reportRequestError, currentErrorReporter } = await import("./error-tracking");
    const sent: string[] = [];
    const sender = (async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    expect(initErrorTracking({ NODE_ENV: "production", ERROR_TRACKING_DSN: `https://${KEY}@errors.example.ir/3` }, sender)).toEqual([]);
    reportRequestError(Object.assign(new Error("not found"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }), "GET", { routePath: "/shop/[label]/[[...path]]" });
    reportRequestError(new RangeError("render failed for ali@example.com"), "GET", { routePath: "/shop/[label]/[[...path]]", routeType: "render" });
    await currentErrorReporter().flush();
    expect(sent).toHaveLength(1);
    const event = JSON.parse(sent[0]!.trim().split("\n")[2]!);
    expect(event.tags).toEqual({ route: "/shop/[label]/[[...path]]", route_type: "render", method: "GET", service: "web" });
    expect(event.exception.values[0]).toMatchObject({ type: "RangeError", value: "render failed for [email]" });
    expect(event.environment).toBe("production");
  });
});
