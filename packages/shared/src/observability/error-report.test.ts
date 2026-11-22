import { describe, expect, it } from "vitest";
import { buildEvent, createErrorReporter, DsnError, parseDsn, parseStack, scrubText } from "./error-report.js";

const KEY = "0123456789abcdef0123456789abcdef";
const dsn = parseDsn(`https://${KEY}@errors.example.ir/3`);

describe("parseDsn", () => {
  it("builds the envelope endpoint and keeps the key out of the URL", () => {
    expect(dsn).toEqual({ endpoint: "https://errors.example.ir/api/3/envelope/", publicKey: KEY });
    expect(parseDsn(`https://${KEY}@host.ir:8443/sub/7`).endpoint).toBe("https://host.ir:8443/sub/api/7/envelope/");
    expect(parseDsn(`http://${KEY}@127.0.0.1:9000/1`).endpoint).toBe("http://127.0.0.1:9000/api/1/envelope/");
  });
  it("rejects anything else with a fixed message that never echoes the input", () => {
    for (const bad of ["", "nonsense", `http://${KEY}@errors.example.ir/3`, `https://errors.example.ir/3`, `https://short@h.ir/3`, `https://${KEY}:pw@h.ir/3`, `https://${KEY}@h.ir/x`, `https://${KEY}@h.ir/3?x=1`, `javascript:${KEY}`]) {
      const e = (() => {
        try {
          parseDsn(bad);
        } catch (x) {
          return x;
        }
      })();
      expect(e, bad).toBeInstanceOf(DsnError);
      expect((e as Error).message).not.toContain(KEY);
    }
  });
});

describe("scrubText", () => {
  it("removes e-mails, phone and card numbers (Persian digits too), tokens, credentials, queries and database ids", () => {
    const s = scrubText(
      "user ali@example.com phone ۰۹۱۲۳۴۵۶۷۸۹ card 6037-9911-2233-4455 jwt eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl Bearer abc.def key=" +
        "Zx9".repeat(12) + " url https://bank.ir/pay?token=secret#frag store cmwq4zcmb003snknwtyf6sq7o",
    );
    for (const leak of ["ali@", "۰۹۱۲", "6037", "eyJ", "abc.def", "Zx9Zx9", "token=secret", "cmwq4z"]) expect(s, leak).not.toContain(leak);
    expect(s).toContain("https://bank.ir/pay?[query]");
  });
  it("removes credentials of connection URLs with internal (dot-less) hosts and key=value secrets (security review 2026-11-22)", () => {
    const s = scrubText("connect failed postgresql://storebuilder:S3cr3t!pw@postgres:5432/storebuilder; redis://:vk-pass@valkey:6379 password=hunter2 api_key: abc123 secret=xyz");
    for (const leak of ["S3cr3t", "storebuilder:", "vk-pass", "hunter2", "abc123", "xyz"]) expect(s, leak).not.toContain(leak);
    expect(s).toContain("postgresql://[credentials]@postgres:5432");
    expect(s).toContain("redis://[credentials]@valkey:6379");
  });
  it("stays fast on a huge message without spaces or @ (bounded before any pattern runs)", () => {
    const t = performance.now();
    scrubText("a".repeat(500_000));
    scrubText(`${"x".repeat(200_000)}@${"y".repeat(200_000)}`);
    expect(performance.now() - t).toBeLessThan(200);
  });
  it("keeps short numbers and plain words, and bounds the length", () => {
    expect(scrubText("timeout after 5000 ms on port 5432")).toBe("timeout after 5000 ms on port 5432");
    expect(scrubText("word ".repeat(200))).toHaveLength(300);
  });
});

describe("parseStack", () => {
  it("cuts absolute paths to the repository part and marks dependencies as not in-app; oldest frame first", () => {
    const e = new Error("x");
    e.stack = [
      "Error: x",
      "    at StoresService.create (D:\\work\\store-builder\\apps\\api\\src\\modules\\stores\\service.ts:42:11)",
      "    at async Promise.all (index 0)",
      "    at Router.handle (/srv/app/node_modules/express/lib/router/index.js:284:7)",
      "    at file:///srv/app/packages/shared/dist/lib/text.js:10:3",
    ].join("\n");
    const f = parseStack(e.stack);
    expect(f.map((x) => x.filename)).toEqual(["packages/shared/dist/lib/text.js", "node_modules/express/lib/router/index.js", "apps/api/src/modules/stores/service.ts"]);
    expect(f.at(-1)).toMatchObject({ function: "StoresService.create", lineno: 42, colno: 11, in_app: true });
    expect(f[1]!.in_app).toBe(false);
    expect(JSON.stringify(f)).not.toMatch(/D:|\/srv\//);
  });
});

describe("buildEvent", () => {
  it("holds only the class, the scrubbed message, frames and valid bounded tags", () => {
    const err = new TypeError("boom for a@b.co");
    const ev = buildEvent(err, { eventId: "e".repeat(32), timestampMs: 1_700_000_000_000, service: "api", environment: "production", release: "1.2.3", tags: { route: "/api/stores/:storeId", method: "POST", request_id: "req-1234abcd", "Bad Key": "x", cookie: "a=b; c=d", note: "line\nbreak" } });
    expect(ev.exception.values[0]).toMatchObject({ type: "TypeError", value: "boom for [email]" });
    expect(ev.tags).toEqual({ route: "/api/stores/:storeId", method: "POST", request_id: "req-1234abcd", service: "api" });
    expect(ev).toMatchObject({ environment: "production", release: "1.2.3", level: "error", timestamp: 1_700_000_000 });
    expect(Object.keys(ev)).not.toContain("request");
    expect(Object.keys(ev)).not.toContain("user");
  });
  it("a thrown non-Error becomes a NonError without its content when it is not a string", () => {
    expect(buildEvent({ password: "x" }, { eventId: "a", timestampMs: 0, service: "api", environment: "t" }).exception.values[0]).toEqual({ type: "NonError", value: "object" });
  });
});

describe("createErrorReporter", () => {
  function harness(o: { status?: number; reject?: boolean; perMinute?: number } = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    const outcomes: string[] = [];
    let t = 1_000_000;
    const r = createErrorReporter({
      dsn,
      service: "api",
      environment: "test",
      perMinute: o.perMinute,
      now: () => t,
      randomHex: () => "f".repeat(32),
      onOutcome: (x) => outcomes.push(x),
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (o.reject) throw new Error("network down: https://errors.example.ir");
        return new Response(null, { status: o.status ?? 200 });
      }) as typeof fetch,
    });
    return { r, calls, outcomes, tick: (ms: number) => (t += ms) };
  }

  it("sends one envelope (header, item header, event) with the key in the auth header, never in the URL", async () => {
    const h = harness();
    h.r.capture(new Error("x"), { route: "/api/health" });
    await h.r.flush();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.url).toBe("https://errors.example.ir/api/3/envelope/");
    expect((h.calls[0]!.init.headers as Record<string, string>)["x-sentry-auth"]).toContain(`sentry_key=${KEY}`);
    const lines = String(h.calls[0]!.init.body).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ event_id: "f".repeat(32) });
    expect(lines[1]).toEqual({ type: "event" });
    expect(lines[2].tags).toEqual({ route: "/api/health", service: "api" });
    expect(h.outcomes).toEqual(["sent"]);
  });

  it("de-duplicates the same error at the same place for a minute, and rate-limits bursts", async () => {
    const h = harness({ perMinute: 3 });
    const same = new Error("same");
    for (let i = 0; i < 5; i++) h.r.capture(same);
    expect(h.outcomes.filter((x) => x === "duplicate")).toHaveLength(4);
    for (let i = 0; i < 5; i++) h.r.capture(new Error("other"), { route: `/r${i}` });
    await h.r.flush();
    expect(h.calls).toHaveLength(3);
    expect(h.outcomes.filter((x) => x === "rate_limited")).toHaveLength(3); // 1 "same" + 2 others fill the minute
    h.tick(61_000);
    h.r.capture(same);
    await h.r.flush();
    expect(h.calls).toHaveLength(4);
  });

  it("never throws: a refused or failed send is only an outcome", async () => {
    for (const o of [{ status: 500 }, { reject: true }]) {
      const h = harness(o);
      expect(() => h.r.capture(new Error("x"))).not.toThrow();
      await h.r.flush();
      expect(h.outcomes).toEqual(["failed"]);
    }
  });
});
