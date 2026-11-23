import { parseProviderNumber } from "@store-builder/shared/modules/pricing/pricing";
import type { RateReadings, RateSource } from "../application/ports.js";

/**
 * Navasan (navasan.tech) latest rates (phase 3.2b). Documented: GET /latest/?api_key=KEY, an object keyed by item symbol, each item
 * { value, change, timestamp (unix s), date }. We read `usd_sell` (Tehran free-market dollar, sell) and `18ayar` (18k gold, per gram).
 *
 * Security: the host is fixed (no configurable URL, so no SSRF); HTTPS unless the super admin explicitly allowed plain HTTP (the provider
 * documents only HTTP, and then the key travels unencrypted); redirects are refused; the answer is size-capped and parsed defensively. The
 * key is part of the request URL, so no error from here ever carries the URL or the underlying error text.
 */
export class RateSourceError extends Error {
  constructor(readonly reason: "http_status" | "network" | "too_large" | "bad_json") {
    super(`rate source failed: ${reason}`);
    this.name = "RateSourceError";
  }
}

const MAX_BYTES = 256 * 1024;
const ITEMS = { USD: "usd_sell", GOLD18: "18ayar" } as const;

export interface NavasanOptions {
  unit: "toman" | "rial";
  allowInsecureHttp: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Tests only. */
  baseUrl?: string;
}

/** Reads at most MAX_BYTES, counting while streaming (a chunked answer without a length is cut off, never buffered whole). */
async function readCapped(res: Response): Promise<string> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) throw new RateSourceError("too_large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RateSourceError("too_large");
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

export class NavasanSource implements RateSource {
  readonly name = "navasan";

  constructor(
    private readonly apiKey: string,
    private readonly opts: NavasanOptions,
  ) {}

  async fetch(): Promise<RateReadings> {
    const base = this.opts.baseUrl ?? (this.opts.allowInsecureHttp ? "http://api.navasan.tech" : "https://api.navasan.tech");
    const url = `${base}/latest/?api_key=${encodeURIComponent(this.apiKey)}`;
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(url, { redirect: "error", signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000), headers: { accept: "application/json" } });
    } catch {
      throw new RateSourceError("network");
    }
    if (!res.ok) throw new RateSourceError("http_status");
    let body: unknown;
    try {
      body = JSON.parse(await readCapped(res));
    } catch (e) {
      throw e instanceof RateSourceError ? e : new RateSourceError("bad_json");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RateSourceError("bad_json");
    const out: RateReadings = {};
    for (const [code, key] of Object.entries(ITEMS) as [keyof typeof ITEMS, string][]) {
      const item = (body as Record<string, unknown>)[key];
      if (!item || typeof item !== "object") continue;
      const { value, timestamp } = item as { value?: unknown; timestamp?: unknown };
      const rateToman = parseProviderNumber(value, this.opts.unit);
      const ts = typeof timestamp === "number" ? timestamp : typeof timestamp === "string" && /^\d{9,11}$/.test(timestamp) ? Number(timestamp) : NaN;
      if (rateToman === null || !Number.isFinite(ts)) continue;
      out[code] = { rateToman, observedAt: new Date(ts * 1000) };
    }
    return out;
  }
}
