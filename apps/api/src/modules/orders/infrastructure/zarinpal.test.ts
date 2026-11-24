import { describe, expect, it } from "vitest";
import { ZarinpalGateway } from "./zarinpal.js";

const MID = "1344b5d4-0048-11e8-94db-005056a205be";
const AUTH = `A${"0".repeat(34)}1`;

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
  return { gw: new ZarinpalGateway({ fetchImpl }), calls };
}

describe("Zarinpal v4 adapter (phase 3.5)", () => {
  it("request: fixed live/sandbox hosts, rial, IRR, auto_verify off, JSON headers, no redirects", async () => {
    const { gw, calls } = fake(() => ({ body: { data: { code: 100, message: "Success", authority: AUTH, fee_type: "Merchant", fee: 100 }, errors: [] } }));
    const r = await gw.request({ sandbox: false, merchantId: MID, amountRial: 2_300_000, description: "x".repeat(600), callbackUrl: "https://shop.example.com/checkout/payment/return", orderRef: "12", mobile: "09123456789" });
    expect(r).toEqual({ ok: true, authority: AUTH });
    expect(calls[0]!.url).toBe("https://payment.zarinpal.com/pg/v4/payment/request.json");
    expect(calls[0]!.init.redirect).toBe("error");
    expect(calls[0]!.init.headers).toMatchObject({ accept: "application/json", "content-type": "application/json" });
    expect(calls[0]!.body).toMatchObject({ merchant_id: MID, amount: 2_300_000, currency: "IRR", callback_url: "https://shop.example.com/checkout/payment/return", metadata: { auto_verify: false, order_id: "12", mobile: "09123456789" } });
    expect(calls[0]!.body.description).toHaveLength(500);
    await gw.request({ sandbox: true, merchantId: MID, amountRial: 10_000, description: "d", callbackUrl: "https://x/y", orderRef: "1", mobile: null });
    expect(calls[1]!.url).toBe("https://sandbox.zarinpal.com/pg/v4/payment/request.json");
    expect(calls[1]!.body.metadata).not.toHaveProperty("mobile");
    expect(gw.startUrl(false, AUTH)).toBe(`https://payment.zarinpal.com/pg/StartPay/${AUTH}`);
    expect(gw.startUrl(true, AUTH)).toBe(`https://sandbox.zarinpal.com/pg/StartPay/${AUTH}`);
  });

  it("request failures carry only the code: error shapes, a malformed authority, no answer, not JSON", async () => {
    const answers: Parameters<typeof fake>[0][] = [
      () => ({ status: 400, body: { data: [], errors: { code: -9, message: "The input params invalid, validation error.", validations: [{ amount: "x" }] } } }),
      () => ({ body: { data: { code: 100, authority: "A<script>" }, errors: [] } }),
      () => "throw",
      () => ({ raw: "<html>gateway</html>" }),
    ];
    const out = [];
    for (const a of answers) out.push(await fake(a).gw.request({ sandbox: false, merchantId: MID, amountRial: 10_000, description: "d", callbackUrl: "https://x/y", orderRef: "1", mobile: null }));
    expect(out).toEqual([{ ok: false, code: -9 }, { ok: false, code: 100 }, { ok: false, code: null }, { ok: false, code: null }]);
  });

  it("verify: 100 and 101 are paid (with reference and masked card); only -50/-54 are definite failures; -51/-53/-55 and the rest are unknown", async () => {
    const v = (body: unknown) => fake(() => ({ body })).gw.verify({ sandbox: false, merchantId: MID, amountRial: 10_000, authority: AUTH });
    expect(await v({ data: { code: 100, ref_id: 201, card_pan: "502229******5995", card_hash: "h", fee: 0 }, errors: [] })).toEqual({ outcome: "paid", code: 100, refId: "201", cardPan: "502229******5995", fee: 0 });
    expect(await v({ data: { code: 101, ref_id: 201, card_pan: "<b>" }, errors: [] })).toMatchObject({ outcome: "paid", code: 101, cardPan: null });
    expect(await v({ data: { code: 100 }, errors: [] })).toEqual({ outcome: "unknown" }); // a success without a reference is not trusted
    expect(await v({ data: {}, errors: { code: -51, message: "Session is not valid, session is not active paid try." } })).toEqual({ outcome: "unknown", code: -51 });
    expect(await v({ data: {}, errors: { code: -53, message: "other merchant" } })).toEqual({ outcome: "unknown", code: -53 });
    expect(await v({ data: {}, errors: { code: -54, message: "Invalid authority." } })).toEqual({ outcome: "failed", code: -54 });
    expect(await v({ data: {}, errors: { code: "-50", message: "amount mismatch" } })).toEqual({ outcome: "failed", code: -50 });
    expect(await v({ data: {}, errors: { code: -12, message: "Too many attempts" } })).toEqual({ outcome: "unknown", code: -12 });
    expect(await v({ data: {}, errors: { authority: ["The authority must be 36 characters.", "-54"] } })).toEqual({ outcome: "unknown", code: null });
    expect(await fake(() => "throw").gw.verify({ sandbox: false, merchantId: MID, amountRial: 1, authority: AUTH })).toEqual({ outcome: "unknown" });
  });

  it("inquiry: only the documented statuses", async () => {
    const q = (body: unknown) => fake(() => ({ body })).gw.inquiry({ sandbox: true, merchantId: MID, authority: AUTH });
    expect(await q({ data: { status: "PAID", code: 100, message: "Success" }, errors: [] })).toEqual({ status: "PAID" });
    expect(await q({ data: { status: "IN_BANK" }, errors: [] })).toEqual({ status: "IN_BANK" });
    expect(await q({ data: { status: "WHATEVER" }, errors: [] })).toEqual({ status: "unknown" });
    expect(await q({ data: [], errors: { code: -54 } })).toEqual({ status: "unknown" });
  });

  it("an answer larger than 64 KiB is not read", async () => {
    const { gw } = fake(() => ({ raw: JSON.stringify({ data: { code: 100, ref_id: 1 }, pad: "x".repeat(70_000) }) }));
    expect(await gw.verify({ sandbox: false, merchantId: MID, amountRial: 1, authority: AUTH })).toEqual({ outcome: "unknown" });
  });
});
