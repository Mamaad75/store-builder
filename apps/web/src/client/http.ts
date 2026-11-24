import { rebuildDomainError } from "@store-builder/shared/errors/registry";

/**
 * The browser's own door to the API (ADR 0001): same-origin `fetch` to `/api/*` (Caddy routes it to the NestJS API in production, Next
 * proxies it in development). The browser sends the session cookie and the platform Origin by itself; nothing here handles credentials.
 * Domain errors are rebuilt as instances of the same classes the services throw, so the form handlers keep their `instanceof` logic.
 */
export class ApiUnavailableError extends Error {
  constructor() {
    super("api unavailable");
    this.name = "ApiUnavailableError";
  }
}
export class ApiHttpError extends Error {
  constructor(readonly status: number) {
    super(`API answered ${status}`);
    this.name = "ApiHttpError";
  }
}
/** The session is missing or revoked: the caller sends the person to /login. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

type Opts = { body?: unknown; raw?: Blob | ArrayBuffer | Uint8Array; query?: Record<string, string | undefined>; headers?: Record<string, string> };

export async function send<T = void>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, opts: Opts = {}): Promise<T> {
  const qs = opts.query ? new URLSearchParams(Object.entries(opts.query).filter((e): e is [string, string] => e[1] !== undefined)).toString() : "";
  const headers: Record<string, string> = { ...opts.headers, accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.raw !== undefined) {
    headers["content-type"] = "application/octet-stream";
    body = opts.raw as BodyInit;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${path}${qs ? `?${qs}` : ""}`, { method, headers, body, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiUnavailableError();
  }
  let json: unknown = null;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  }
  if (res.ok) return (json ?? undefined) as T;
  const b = json as { errorName?: unknown; payload?: unknown; code?: unknown; fieldErrors?: unknown; retryAfterSeconds?: unknown; error?: unknown } | null;
  const domain = rebuildDomainError(b?.errorName, b?.payload) ?? fromV1(b?.error);
  if (domain) throw domain;
  if (res.status === 401 && (b?.code === "unauthenticated" || (b?.error as { reason?: unknown } | undefined)?.reason === "unauthenticated")) throw new UnauthenticatedError();
  throw Object.assign(new ApiHttpError(res.status), { body: b });
}

/**
 * /api/v1 answers `{ error: { code, message, reason, fieldErrors?, retryAfterSeconds?, details? } }` (the platform pages call it). The
 * domain error is rebuilt from `reason` (the class name) and its own fields, exactly like the unversioned `{ errorName, payload }`.
 */
function fromV1(e: unknown): Error | null {
  if (!e || typeof e !== "object") return null;
  const v = e as { reason?: unknown; fieldErrors?: unknown; retryAfterSeconds?: unknown; details?: unknown };
  const details = v.details && typeof v.details === "object" ? (v.details as Record<string, unknown>) : {};
  return rebuildDomainError(v.reason, {
    ...details,
    ...(v.fieldErrors !== undefined ? { fieldErrors: v.fieldErrors } : {}),
    ...(v.retryAfterSeconds !== undefined ? { retryAfterSeconds: v.retryAfterSeconds } : {}),
  });
}

export const enc = encodeURIComponent;
