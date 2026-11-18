import { formatLog, redact } from "./log";

/**
 * Operational alerts through a Bale bot (decision D14-3; phase 14 task K4). Bale's bot API is Telegram-compatible:
 *   POST <BALE_API_BASE>/bot<token>/sendMessage   {"chat_id": ..., "text": ...}
 * Rules:
 *  - the token and chat id come from the environment only (BALE_BOT_TOKEN, BALE_CHAT_ID); alerts are simply off when both are unset;
 *  - the token is part of the request PATH, so no URL, token or response body is ever logged or put into an error message;
 *  - sending is bounded by a timeout and `notify` never throws: a broken alert channel must not break the job it reports on;
 *  - https only, except a loopback base used by tests.
 */
export interface AlertConfig {
  token: string;
  chatId: string;
  apiBase: string;
  timeoutMs: number;
  source: string;
}

export class AlertConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertConfigError";
  }
}

/** Sending failed. The message is a fixed description: never a URL, token, status text or response body. */
export class AlertSendError extends Error {
  constructor(reason: "http_status" | "api_rejected" | "timeout" | "network") {
    super(`alert not delivered: ${reason}`);
    this.name = "AlertSendError";
  }
}

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{10,}$/;
const CHAT_RE = /^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,64})$/;
const MAX_TEXT = 4096; // Bale's sendMessage limit
const DEFAULT_TIMEOUT_MS = 10_000;

function isLoopbackHttp(base: URL): boolean {
  return base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
}

/** Alert configuration, or null when alerts are not configured at all. Half or invalid configuration throws (names only). */
export function readAlertConfig(env: Record<string, string | undefined> = process.env): AlertConfig | null {
  const token = (env.BALE_BOT_TOKEN ?? "").trim();
  const chatId = (env.BALE_CHAT_ID ?? "").trim();
  if (!token && !chatId) return null;
  const bad: string[] = [];
  if (!TOKEN_RE.test(token)) bad.push("BALE_BOT_TOKEN");
  if (!CHAT_RE.test(chatId)) bad.push("BALE_CHAT_ID");
  let base: URL | null = null;
  try {
    base = new URL((env.BALE_API_BASE ?? "").trim() || "https://tapi.bale.ai");
  } catch {
    bad.push("BALE_API_BASE");
  }
  if (base && base.protocol !== "https:" && !isLoopbackHttp(base)) bad.push("BALE_API_BASE");
  if (bad.length) throw new AlertConfigError(`Alert configuration invalid or incomplete: ${[...new Set(bad)].join(", ")}`);
  return {
    token,
    chatId,
    apiBase: base!.origin + base!.pathname.replace(/\/+$/, ""),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    source: (env.APP_ROOT_DOMAIN ?? "").trim() || "store-builder",
  };
}

/** Plain-text alert: source, event and the (redacted, bounded) fields, one per line. */
export function formatAlert(source: string, event: string, fields: Record<string, unknown> = {}): string {
  const safe = redact(fields) as Record<string, unknown>;
  const lines = [`⚠️ هشدار ${source}`, `رویداد: ${event}`, ...Object.entries(safe).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)];
  const text = lines.join("\n");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** One sendMessage call. Throws AlertSendError (fixed messages only). */
export async function sendAlert(cfg: AlertConfig, text: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.apiBase}/bot${cfg.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: /^-?\d+$/.test(cfg.chatId) ? Number(cfg.chatId) : cfg.chatId, text }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
      redirect: "error",
    });
  } catch (e) {
    throw new AlertSendError(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "network");
  }
  if (!res.ok) throw new AlertSendError("http_status");
  const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
  if (body?.ok !== true) throw new AlertSendError("api_rejected");
}

export interface Notifier {
  (event: string, fields?: Record<string, unknown>): Promise<void>;
}

/**
 * The notifier jobs use. With no configuration it only writes a local log line. It NEVER throws: delivery problems become a
 * structured `alert.failed` line (error class only), so the job's own outcome and logs stay intact.
 */
export function createNotifier(
  cfg: AlertConfig | null,
  deps: { fetchImpl?: typeof fetch; write?: (line: string) => void } = {},
): Notifier {
  const write = deps.write ?? ((line: string) => console.error(line));
  return async (event, fields = {}) => {
    if (!cfg) {
      write(formatLog("warn", "alert.disabled", { event }));
      return;
    }
    try {
      await sendAlert(cfg, formatAlert(cfg.source, event, fields), deps.fetchImpl);
    } catch (e) {
      write(formatLog("error", "alert.failed", { event, errorClass: e instanceof Error ? e.name : "UnknownError", reason: e instanceof AlertSendError ? e.message : undefined }));
    }
  };
}
