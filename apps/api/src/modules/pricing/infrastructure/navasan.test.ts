import { describe, expect, it } from "vitest";
import { NavasanSource, RateSourceError } from "./navasan.js";

type Call = { url: string; init: RequestInit | undefined };
function fake(body: unknown, init: { status?: number; raw?: string } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, i?: RequestInit) => {
    calls.push({ url, init: i });
    return new Response(init.raw ?? JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const ts = 1_795_000_000;

describe("NavasanSource", () => {
  it("reads usd_sell and 18ayar over HTTPS with redirects refused", async () => {
    const f = fake({ usd_sell: { value: "103,500", change: 1, timestamp: ts }, "18ayar": { value: "8450000", timestamp: String(ts) }, sekkeh: { value: "1" } });
    const r = await new NavasanSource("k3y", { unit: "toman", allowInsecureHttp: false, fetchImpl: f.fetchImpl }).fetch();
    expect(r).toEqual({ USD: { rateToman: 103_500, observedAt: new Date(ts * 1000) }, GOLD18: { rateToman: 8_450_000, observedAt: new Date(ts * 1000) } });
    expect(f.calls[0]!.url).toBe("https://api.navasan.tech/latest/?api_key=k3y");
    expect(f.calls[0]!.init?.redirect).toBe("error");
  });
  it("plain HTTP only when the super admin allowed it; rial is converted", async () => {
    const f = fake({ usd_sell: { value: "1035000", timestamp: ts } });
    const r = await new NavasanSource("k", { unit: "rial", allowInsecureHttp: true, fetchImpl: f.fetchImpl }).fetch();
    expect(f.calls[0]!.url.startsWith("http://api.navasan.tech/")).toBe(true);
    expect(r.USD?.rateToman).toBe(103_500);
  });
  it("skips malformed items; errors never carry the URL or the key", async () => {
    const f = fake({ usd_sell: { value: "-1", timestamp: ts }, "18ayar": { value: "8000000" } });
    expect(await new NavasanSource("k", { unit: "toman", allowInsecureHttp: false, fetchImpl: f.fetchImpl }).fetch()).toEqual({});
    for (const [body, opts] of [[{}, { status: 401 }], [null, { raw: "<html>" }], [null, { raw: "[1,2]" }]] as const) {
      const g = fake(body, opts);
      const e = await new NavasanSource("S3CRET", { unit: "toman", allowInsecureHttp: false, fetchImpl: g.fetchImpl }).fetch().catch((x: unknown) => x);
      expect(e).toBeInstanceOf(RateSourceError);
      expect(String((e as Error).message)).not.toContain("S3CRET");
    }
    const broken = (async () => {
      throw new Error("connect ECONNREFUSED https://api.navasan.tech/latest/?api_key=S3CRET");
    }) as unknown as typeof fetch;
    const e = await new NavasanSource("S3CRET", { unit: "toman", allowInsecureHttp: false, fetchImpl: broken }).fetch().catch((x: unknown) => x);
    expect(e).toMatchObject({ name: "RateSourceError", reason: "network" });
    expect(JSON.stringify(e) + String(e)).not.toContain("S3CRET");
  });
  it("regression (security review 3.2b): an endless chunked answer is cut off while streaming, never buffered whole", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(64 * 1024));
      },
    });
    const fetchImpl = (async () => new Response(endless, { status: 200 })) as unknown as typeof fetch;
    await expect(new NavasanSource("k", { unit: "toman", allowInsecureHttp: false, fetchImpl }).fetch()).rejects.toMatchObject({ reason: "too_large" });
    expect(pulled).toBeLessThan(10); // stopped right after the 256 KiB cap
  });
  it("refuses oversized answers", async () => {
    const f = fake(null, { raw: JSON.stringify({ pad: "x".repeat(300 * 1024) }) });
    await expect(new NavasanSource("k", { unit: "toman", allowInsecureHttp: false, fetchImpl: f.fetchImpl }).fetch()).rejects.toMatchObject({ reason: "too_large" });
  });
});
