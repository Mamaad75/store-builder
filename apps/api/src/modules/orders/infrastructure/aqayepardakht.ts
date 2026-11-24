import { GATEWAY_REF_RE } from "@store-builder/shared/modules/orders/orders";
import type { GatewayRequest, GatewayVerify, PaymentGateway, VerifyResult } from "../application/ports.js";

/**
 * Aghaye Pardakht payment gateway, API v2 (D35c-1), per the official documentation (aqayepardakht.ir/api, read 2026-11-24):
 *  - POST /api/v2/create {pin, amount (TOMAN, 1,000..400,000,000), callback, callback_method, invoice_id, mobile, description}
 *    -> 200 {status: "success", transid} | 422 {status: "error", code};
 *  - the buyer is sent to /startpay/{transid} (sandbox: /startpay/sandbox/{transid}); that page checks the Referer against the gateway's
 *    registered domain (-16), so the browser must send the store's origin;
 *  - the return (callback_method GET) carries transid, status (1 paid / 0 not), tracking_number, cardnumber (masked), bank, invoice_id;
 *  - POST /api/v2/verify {pin, amount (toman), transid} -> 200 {status: "success", code: "1"} (verified now) |
 *    422 {status: "error", code: "2"} (verified before: still paid) | code "0" (not paid) | negative codes.
 *  - sandbox: pin "sandbox".
 * Transaction inquiry needs the merchant's ACCOUNT number and key (not the gateway pin), so it is not used: the reconciler verifies
 * directly, which is harmless on an unpaid transaction (code 0).
 *
 * Security: one fixed host (no configurable URL in production), HTTPS only, redirects refused, answers size-capped and parsed
 * defensively; no error from here ever carries a body, a URL, the pin or the provider's message. The store's amounts are in toman; the
 * service passes rial (as for every gateway) and this adapter divides by 10 (always exact: rial = toman x 10).
 */
const HOST = "https://panel.aqayepardakht.ir";
const MAX_BYTES = 64 * 1024;
const SANDBOX_PIN = "sandbox";
/** Verify answers that settle the attempt as NOT paid: the amount does not match the transaction (-10), no such transaction (-8). */
const DEFINITE_VERIFY_FAILURES = new Set([-10, -8]);

export interface AqayePardakhtOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Development and tests only: a local fake gateway instead of the real host. */
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
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export class AqayePardakhtGateway implements PaymentGateway {
  constructor(private readonly opts: AqayePardakhtOptions = {}) {}

  private base(): string {
    return this.opts.baseUrlOverride ?? HOST;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${this.base()}${path}`, {
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
      return obj(JSON.parse(text));
    } catch {
      return null;
    }
  }

  startUrl(sandbox: boolean, transid: string): string {
    return `${this.base()}/startpay/${sandbox ? "sandbox/" : ""}${encodeURIComponent(transid)}`;
  }

  async request(r: GatewayRequest): Promise<{ ok: true; authority: string } | { ok: false; code: number | null }> {
    const res = await this.post("/api/v2/create", {
      pin: r.sandbox ? SANDBOX_PIN : r.merchantId,
      amount: Math.round(r.amountRial / 10),
      callback: r.callbackUrl,
      callback_method: "GET",
      invoice_id: `${r.orderRef}-${r.attemptRef}`, // unique per attempt
      description: r.description.slice(0, 255),
      ...(r.mobile ? { mobile: r.mobile } : {}),
    });
    if (!res) return { ok: false, code: null };
    if (res.status === "success" && typeof res.transid === "string" && GATEWAY_REF_RE.AQAYEPARDAKHT.test(res.transid)) return { ok: true, authority: res.transid };
    return { ok: false, code: toInt(res.code) };
  }

  async verify(v: GatewayVerify): Promise<VerifyResult> {
    const res = await this.post("/api/v2/verify", { pin: v.sandbox ? SANDBOX_PIN : v.merchantId, amount: Math.round(v.amountRial / 10), transid: v.authority });
    if (!res) return { outcome: "unknown" };
    const code = toInt(res.code);
    // 1 = verified now; 2 (an "error") = verified before: the money is captured either way. The gateway returns no reference of its own
    // from verify, so the transaction id is the reference.
    if ((res.status === "success" && code === 1) || (res.status === "error" && code === 2)) return { outcome: "paid", code: code!, refId: v.authority, cardPan: null, fee: null };
    if (code === 0) return { outcome: "pending", code: 0 };
    if (code !== null && DEFINITE_VERIFY_FAILURES.has(code)) return { outcome: "failed", code };
    return { outcome: "unknown", code };
  }
}
