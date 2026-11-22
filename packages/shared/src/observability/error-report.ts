/**
 * Error tracking (phase 2.6, ADR 0002 §2.12): a deliberately small reporter for a SELF-HOSTED GlitchTip (Sentry-compatible ingest API).
 * Not the Sentry SDK: that one instruments the process and attaches request headers, bodies and breadcrumbs on its own. Here an event
 * holds ONLY what this file puts in it:
 *   - the error class and a SCRUBBED, shortened message (e-mail addresses, long digit runs, tokens and URL queries removed);
 *   - stack frames (file, function, line), with absolute paths cut to the repository part;
 *   - a few bounded tags chosen by the caller (service, route TEMPLATE, method, job or event type, request id).
 * Never: headers, cookies, bodies, query strings, user/store identifiers, environment values.
 * The DSN is configuration (an ingest key): it is never logged and never part of an error message.
 * The reporter never throws and never blocks the caller: sending is fire-and-forget with a timeout, rate-limited and de-duplicated.
 */

export interface Dsn {
  /** https://host/api/<project>/envelope/ */
  endpoint: string;
  publicKey: string;
}

export class DsnError extends Error {
  constructor() {
    // fixed text: the DSN itself is never echoed
    super("ERROR_TRACKING_DSN: not a valid DSN (https://<key>@<host>/<project id>)");
    this.name = "DsnError";
  }
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Parses `https://<public key>@<host>[:port][/path]/<project id>`. Plain http only for a loopback host (local tests). */
export function parseDsn(raw: string): Dsn {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new DsnError();
  }
  const project = u.pathname.split("/").filter(Boolean).pop() ?? "";
  const okScheme = u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname));
  if (!okScheme || !/^[a-f0-9]{16,64}$/i.test(u.username) || u.password || !/^\d{1,12}$/.test(project) || u.search || u.hash) throw new DsnError();
  const prefix = u.pathname.split("/").filter(Boolean).slice(0, -1).join("/");
  return { endpoint: `${u.protocol}//${u.host}/${prefix ? `${prefix}/` : ""}api/${project}/envelope/`, publicKey: u.username };
}

const MAX_MESSAGE = 300;
/** Work is bounded before any pattern runs: a huge message can never make scrubbing slow (security review 2026-11-22). */
const MAX_SCAN = 2000;

/**
 * Removes values that may identify a person or grant access from free text. Conservative on purpose: an error message is debugging
 * help, not data. Persian/Arabic digits count as digits.
 */
export function scrubText(input: string): string {
  return input
    .slice(0, MAX_SCAN)
    // credentials in any URL, also with a dot-less host as on the internal network (postgresql://user:pw@postgres:5432, redis://:pw@valkey)
    .replace(/\b([a-z][a-z0-9+.-]{1,20}:\/\/)[^\s/@]{0,200}@/gi, "$1[credentials]@")
    .replace(/\b(pass(?:word)?|pwd|secret|token|api[-_]?key)\s{0,3}[=:]\s{0,3}[^\s&;,]{1,200}/gi, "$1=[redacted]")
    .replace(/[^\s@<>"']{1,64}@[^\s@<>"']{1,253}\.[^\s@<>"']{1,63}/g, "[email]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]") // JWT
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, "$1?[query]")
    .replace(/(?:Bearer|Basic)\s+[\w.~+/=-]+/gi, "[credential]")
    .replace(/\b[A-Za-z0-9+/_=-]{32,}\b/g, "[token]")
    .replace(/\bc[a-z0-9]{24}\b/g, "[id]") // database ids (cuid)
    .replace(/[+]?[\d۰-۹٠-٩][\d۰-۹٠-٩\s-]{4,}[\d۰-۹٠-٩]/g, "[number]")
    .slice(0, MAX_MESSAGE);
}

export interface Frame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/** V8 stack lines -> Sentry frames (oldest first), at most 40. Absolute paths are cut to `apps/…`, `packages/…` or `node_modules/…`. */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.slice(0, 16_000).split("\n").slice(1, 41)) {
    const m = /^\s*at (?:(.{1,300}?) \()?(.{1,500}?):(\d+):(\d+)\)?$/.exec(line.slice(0, 900));
    if (!m) continue;
    const file = m[2]!.replace(/^file:\/\/\/?/, "").replace(/\\/g, "/");
    const cut = file.startsWith("node:") ? file : (/(?:^|\/)((?:apps|packages|node_modules)\/.*)$/.exec(file)?.[1] ?? file.split("/").slice(-2).join("/"));
    frames.push({ filename: cut, function: (m[1] ?? "<anonymous>").slice(0, 120), lineno: Number(m[3]), colno: Number(m[4]), in_app: !cut.includes("node_modules/") && !cut.startsWith("node:") });
  }
  return frames.reverse();
}

/** Bounded tags: short keys, short values, safe characters only. Anything else is dropped (never truncated into ambiguity). */
export type Tags = Record<string, string | undefined>;
const TAG_KEY = /^[a-z][a-z0-9_.]{0,31}$/;
const TAG_VALUE = /^[\w.:/\-[\]@ ]{1,200}$/;
function cleanTags(tags: Tags): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) if (v !== undefined && TAG_KEY.test(k) && TAG_VALUE.test(v)) out[k] = v;
  return out;
}

export interface ReporterOptions {
  dsn: Dsn;
  service: string;
  environment: string;
  release?: string;
  fetch?: typeof fetch;
  now?: () => number;
  randomHex?: () => string;
  /** At most this many events per minute per process (default 30). */
  perMinute?: number;
  timeoutMs?: number;
  /** Outcome of every capture, for metrics and tests. Must not throw. */
  onOutcome?: (outcome: "sent" | "failed" | "rate_limited" | "duplicate") => void;
}

export interface ErrorReporter {
  capture(error: unknown, tags?: Tags): void;
  /** Waits (bounded) for in-flight sends, e.g. before the process exits. */
  flush(timeoutMs?: number): Promise<void>;
}

/** A reporter that does nothing (error tracking not configured). */
export const NO_REPORTER: ErrorReporter = { capture() {}, flush: async () => {} };

function errorParts(error: unknown): { type: string; message: string; stack?: string } {
  if (error instanceof Error) return { type: error.name || "Error", message: error.message, stack: error.stack };
  return { type: "NonError", message: typeof error === "string" ? error : typeof error };
}

/** Builds the event body (exported for tests). */
export function buildEvent(error: unknown, o: { eventId: string; timestampMs: number; service: string; environment: string; release?: string; tags?: Tags }) {
  const { type, message, stack } = errorParts(error);
  const frames = parseStack(stack);
  return {
    event_id: o.eventId,
    timestamp: o.timestampMs / 1000,
    platform: "node",
    level: "error",
    logger: o.service,
    environment: o.environment.slice(0, 64),
    ...(o.release ? { release: o.release.slice(0, 200) } : {}),
    tags: cleanTags({ ...o.tags, service: o.service }),
    exception: { values: [{ type: type.slice(0, 100), value: scrubText(message), ...(frames.length ? { stacktrace: { frames } } : {}) }] },
  };
}

const hex32 = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export function createErrorReporter(o: ReporterOptions): ErrorReporter {
  const send = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const id = o.randomHex ?? hex32;
  const perMinute = o.perMinute ?? 30;
  const outcome = (x: Parameters<NonNullable<ReporterOptions["onOutcome"]>>[0]) => {
    try {
      o.onOutcome?.(x);
    } catch {
      /* metrics must never break reporting */
    }
  };
  let windowStart = 0;
  let inWindow = 0;
  const recent = new Map<string, number>(); // fingerprint -> last sent (ms)
  const inflight = new Set<Promise<void>>();

  return {
    capture(error, tags = {}) {
      try {
        const t = now();
        const { type, stack } = errorParts(error);
        const top = parseStack(stack).at(-1);
        const fingerprint = `${type}|${top?.filename ?? ""}:${top?.lineno ?? ""}|${tags.route ?? tags.job ?? tags.event_type ?? ""}`;
        const last = recent.get(fingerprint);
        if (last !== undefined && t - last < 60_000) return outcome("duplicate");
        if (t - windowStart >= 60_000) {
          windowStart = t;
          inWindow = 0;
        }
        if (inWindow >= perMinute) return outcome("rate_limited");
        inWindow++;
        recent.set(fingerprint, t);
        if (recent.size > 500) recent.delete(recent.keys().next().value!);

        const eventId = id();
        const event = buildEvent(error, { eventId, timestampMs: t, service: o.service, environment: o.environment, release: o.release, tags });
        const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date(t).toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 5000);
        const p = send(o.dsn.endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_client=store-builder/1.0, sentry_key=${o.dsn.publicKey}` },
          body,
          signal: ctrl.signal,
          redirect: "error", // the envelope (and its key) never follows a redirect to another host
        })
          .then((r) => outcome(r.ok ? "sent" : "failed"))
          .catch(() => outcome("failed"))
          .finally(() => {
            clearTimeout(timer);
            inflight.delete(p);
          });
        inflight.add(p);
      } catch {
        outcome("failed");
      }
    },
    async flush(timeoutMs = 3000) {
      if (inflight.size === 0) return;
      await Promise.race([Promise.allSettled([...inflight]), new Promise((r) => setTimeout(r, timeoutMs))]);
    },
  };
}
