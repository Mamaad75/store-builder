import { describe, expect, it } from "vitest";
import { AqayePardakhtGateway } from "./aqayepardakht.js";

const PIN = "D45DE2605E6E6F98";
const TRANS = "62B827B7E1ECBLLAZ555";

function fake(answer: (url: string, body: any) => { status?: number; body: unknown } | "throw" | { raw: string }) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });
    const a = answer(url, body);
    if (a === "throw") throw new TypeError("fetch failed");
    if ("raw" in a) return new Response(a.raw, { status: 200 });
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { gw: new AqayePardakhtGateway({ fetchImpl }), calls };
}
const req = (sandbox = false) => ({ sandbox, merchantId: PIN, amountRial: 2_300_000, description: "سفارش ۱۲", callbackUrl: "https://shop.example.com/checkout/payment/return/aqayepardakht", orderRef: "12", attemptRef: "a1b2c3d4", mobile: "09123456789" });

describe("Aghaye Pardakht v2 adapter (D35c-1)", () => {
  it("create: fixed host, amount in TOMAN, GET return, invoice id; startpay live and sandbox; sandbox uses the 'sandbox' pin", async () => {
    const { gw, calls } = fake(() => ({ body: { status: "success", transid: TRANS } }));
    expect(await gw.request(req())).toEqual({ ok: true, authority: TRANS });
    expect(calls[0]!.url).toBe("https://panel.aqayepardakht.ir/api/v2/create");
    expect(calls[0]!.init.redirect).toBe("error");
    expect(calls[0]!.body).toEqual({ pin: PIN, amount: 230_000, callback: "https://shop.example.com/checkout/payment/return/aqayepardakht", callback_method: "GET", invoice_id: "12-a1b2c3d4", description: "سفارش ۱۲", mobile: "09123456789" });
    await gw.request(req(true));
    expect(calls[1]!.body.pin).toBe("sandbox");
    expect(gw.startUrl(false, TRANS)).toBe(`https://panel.aqayepardakht.ir/startpay/${TRANS}`);
    expect(gw.startUrl(true, TRANS)).toBe(`https://panel.aqayepardakht.ir/startpay/sandbox/${TRANS}`);
  });

  it("create failures carry only the code (422 shape, a malformed transid, no answer, not JSON)", async () => {
    const out = [];
    for (const a of [
      () => ({ status: 422, body: { status: "error", code: "-15" } }),
      () => ({ body: { status: "success", transid: "<script>" } }),
      () => "throw" as const,
      () => ({ raw: "<html>" }),
    ]) out.push(await fake(a).gw.request(req()));
    expect(out).toEqual([{ ok: false, code: -15 }, { ok: false, code: null }, { ok: false, code: null }, { ok: false, code: null }]);
  });

  it("verify: 1 (now) and 2 (before) are paid with the transid as reference; 0 is 'not paid yet'; -10/-8 fail; the rest is unknown", async () => {
    const v = (status: number, body: unknown) => {
      const f = fake(() => ({ status, body }));
      return f.gw.verify({ sandbox: false, merchantId: PIN, amountRial: 2_300_000, authority: TRANS }).then((r) => ({ r, sent: f.calls[0]!.body }));
    };
    const ok = await v(200, { status: "success", code: "1" });
    expect(ok.r).toEqual({ outcome: "paid", code: 1, refId: TRANS, cardPan: null, fee: null });
    expect(ok.sent).toEqual({ pin: PIN, amount: 230_000, transid: TRANS });
    expect((await v(422, { status: "error", code: "2" })).r).toMatchObject({ outcome: "paid", code: 2 });
    expect((await v(422, { status: "error", code: "0" })).r).toEqual({ outcome: "pending", code: 0 });
    expect((await v(422, { status: "error", code: "-10" })).r).toEqual({ outcome: "failed", code: -10 });
    expect((await v(422, { status: "error", code: "-8" })).r).toEqual({ outcome: "failed", code: -8 });
    expect((await v(422, { status: "error", code: "-9" })).r).toEqual({ outcome: "unknown", code: -9 });
    expect((await v(200, { status: "success", code: "2" })).r).toEqual({ outcome: "unknown", code: 2 }); // not a documented answer
    expect(await fake(() => "throw").gw.verify({ sandbox: false, merchantId: PIN, amountRial: 1, authority: TRANS })).toEqual({ outcome: "unknown" });
  });

  it("has no inquiry (it needs the merchant's account keys): the reconciler verifies directly", () => {
    expect((new AqayePardakhtGateway() as { inquiry?: unknown }).inquiry).toBeUndefined();
  });
});
