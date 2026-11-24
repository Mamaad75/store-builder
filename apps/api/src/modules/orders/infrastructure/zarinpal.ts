import type { GatewayInquiry, GatewayRequest, GatewayVerify, PaymentGateway } from "../application/ports.js";

/**
 * Zarinpal payment gateway, REST v4 (phase 3.5, D35-1), per the official documentation (www.zarinpal.com/docs/paymentGateway, read
 * 2026-11-24):
 *  - POST /pg/v4/payment/request.json {merchant_id, amount, currency, description (<= 500), callback_url, metadata{mobile, order_id,
 *    auto_verify}} -> data.code 100 + data.authority ("A"/"S" + 35 characters);
 *  - the buyer is sent to /pg/StartPay/{authority}; the callback gets ?Authority=...&Status=OK|NOK;
 *  - POST /pg/v4/payment/verify.json {merchant_id, amount (rial), authority} -> 100 (verified now) or 101 (verified before), ref_id, card_pan;
 *  - POST /pg/v4/payment/inquiry.json {merchant_id, authority} -> data.status VERIFIED | PAID | IN_BANK | FAILED | REVERSED (status only:
 *    never used instead of verify);
 *  - errors come back as {data: [] | {}, errors: {code, message, validations}}.
 * We always send amounts in RIAL (currency "IRR") and metadata.auto_verify=false: only our server verifies, and a payment it never verifies is
 * returned to the buyer by Zarinpal.
 *
 * Security: hosts are fixed (live or sandbox, no configurable URL), HTTPS only, 10 s timeout, redirects refused, answers size-capped and parsed
 * defensively. The merchant id is in request bodies; no error from here ever carries a body, a URL or the provider's message.
 */
const HOSTS = { live: "https://payment.zarinpal.com", sandbox: "https://sandbox.zarinpal.com" } as const;
const MAX_BYTES = 64 * 1024;
/**
 * Verify answers that settle the attempt as NOT paid, whatever happens later: the amount does not match the session, the authority is
 * invalid. NOT -51 ("not paid", also the answer while the buyer is still at the bank: a forged early return must not fail a real payment),
 * -53 (another merchant: e.g. the id was changed) or -55: those leave the attempt open for the reconciler (review 3.5).
 */
const DEFINITE_VERIFY_FAILURES = new Set([-50, -54]);

export interface ZarinpalOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Tests only: a local fake gateway instead of the two fixed hosts. */
  baseUrlOverride?: string;
}

async function readCapped(res: Response): Promise<string | null> {
  if (Number(res.headers.get("content-length") ?? "0") > MAX_BYTES || !res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

const toInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^-?\d{1,6}$/.test(v) ? Number(v) : null);

/** The answer's code: data.code on success, errors.code on failure; null when the answer is not understood. */
function codeOf(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { data?: unknown; errors?: unknown };
  const fromData = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? toInt((b.data as { code?: unknown }).code) : null;
  if (fromData !== null) return fromData;
  return b.errors && typeof b.errors === "object" && !Array.isArray(b.errors) ? toInt((b.errors as { code?: unknown }).code) : null;
}

const dataOf = (body: unknown): Record<string, unknown> =>
  body && typeof body === "object" && (body as { data?: unknown }).data && typeof (body as { data?: unknown }).data === "object" && !Array.isArray((body as { data?: unknown }).data)
    ? ((body as { data: Record<string, unknown> }).data)
    : {};

export class ZarinpalGateway implements PaymentGateway {
  constructor(private readonly opts: ZarinpalOptions = {}) {}

  private base(sandbox: boolean): string {
    return this.opts.baseUrlOverride ?? (sandbox ? HOSTS.sandbox : HOSTS.live);
  }

  /** POSTs JSON; null for anything that is not a readable JSON answer (network error, timeout, too large, not JSON). */
  private async post(sandbox: boolean, path: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown } | null> {
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${this.base(sandbox)}${path}`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return null;
    }
    const text = await readCapped(res).catch(() => null);
    if (text === null) return null;
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      return null;
    }
  }

  startUrl(sandbox: boolean, authority: string): string {
    return `${this.base(sandbox)}/pg/StartPay/${encodeURIComponent(authority)}`;
  }

  async request(r: GatewayRequest): Promise<{ ok: true; authority: string } | { ok: false; code: number | null }> {
    const res = await this.post(r.sandbox, "/pg/v4/payment/request.json", {
      merchant_id: r.merchantId,
      amount: r.amountRial,
      currency: "IRR",
      description: r.description.slice(0, 500),
      callback_url: r.callbackUrl,
      metadata: { auto_verify: false, order_id: r.orderRef, ...(r.mobile ? { mobile: r.mobile } : {}) },
    });
    if (!res) return { ok: false, code: null };
    const code = codeOf(res.json);
    const authority = dataOf(res.json).authority;
    if (code === 100 && typeof authority === "string" && /^[AS][0-9A-Za-z]{35}$/.test(authority)) return { ok: true, authority };
    return { ok: false, code };
  }

  async verify(v: GatewayVerify) {
    const res = await this.post(v.sandbox, "/pg/v4/payment/verify.json", { merchant_id: v.merchantId, amount: v.amountRial, authority: v.authority });
    if (!res) return { outcome: "unknown" as const };
    const code = codeOf(res.json);
    if (code === 100 || code === 101) {
      const d = dataOf(res.json);
      const refId = toInt(d.ref_id) ?? (typeof d.ref_id === "string" && /^\d{1,30}$/.test(d.ref_id) ? d.ref_id : null);
      if (refId === null) return { outcome: "unknown" as const }; // a success without a reference is not trusted: checked again later
      const pan = typeof d.card_pan === "string" && /^[0-9*]{6,32}$/.test(d.card_pan) ? d.card_pan : null;
      return { outcome: "paid" as const, code, refId: String(refId), cardPan: pan, fee: toInt(d.fee) };
    }
    if (code !== null && DEFINITE_VERIFY_FAILURES.has(code)) return { outcome: "failed" as const, code };
    return { outcome: "unknown" as const, code };
  }

  async inquiry(q: GatewayInquiry) {
    const res = await this.post(q.sandbox, "/pg/v4/payment/inquiry.json", { merchant_id: q.merchantId, authority: q.authority });
    const status = res ? dataOf(res.json).status : undefined;
    return typeof status === "string" && ["VERIFIED", "PAID", "IN_BANK", "FAILED", "REVERSED"].includes(status)
      ? { status: status as "VERIFIED" | "PAID" | "IN_BANK" | "FAILED" | "REVERSED" }
      : { status: "unknown" as const };
  }
}
