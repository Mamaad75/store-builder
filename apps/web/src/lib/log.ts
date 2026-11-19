/**
 * Structured logging: ONE JSON object per line on stdout (info/warn) or stderr (error), so a log pipeline can parse, filter and alert
 * without regexes. Fields are redacted by NAME (a value under a sensitive key is never printed), and strings are length-bounded.
 * Never pass request bodies, tokens, reset links, addresses or passwords here; redaction is a safety net, not a licence.
 */
export type LogLevel = "info" | "warn" | "error";

const SENSITIVE = /(pass(word)?|secret|token|authorization|cookie|credential|api[-_]?key|email|link|url|hash)/i;
const MAX_STRING = 500;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return { name: value.name }; // never message or stack: they can carry values
  if (depth >= 3) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return String(typeof value);
}

export function formatLog(level: LogLevel, event: string, fields: Record<string, unknown> = {}, now: () => Date = () => new Date()): string {
  const { ts: _ts, level: _l, event: _e, ...rest } = fields; // reserved keys cannot be spoofed by callers
  void _ts; void _l; void _e;
  return JSON.stringify({ ts: now().toISOString(), level, event, ...(redact(rest) as Record<string, unknown>) });
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => console.info(formatLog("info", event, fields)),
  warn: (event: string, fields?: Record<string, unknown>) => console.warn(formatLog("warn", event, fields)),
  error: (event: string, fields?: Record<string, unknown>) => console.error(formatLog("error", event, fields)),
};
