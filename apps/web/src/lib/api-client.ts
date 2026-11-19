/**
 * Server-side client for the NestJS API (ADR 0001, N3). The browser never talks to the API from this app: server actions and server
 * components call it over the internal network (INTERNAL_API_URL) and forward the user's session cookie.
 *
 * The API refuses state-changing requests without an Origin of the platform, so the platform's own origin is always sent. The client IP
 * (already derived by getClientIp from the trusted proxy header) travels as a single X-Forwarded-For entry; the API counts proxy hops
 * from the right (TRUST_PROXY_HOPS=1), so this is the address it rate-limits on.
 */
export interface ApiResult<T = unknown> {
  status: number;
  body: T | null;
  /** Raw Set-Cookie header values of the response. */
  setCookies: string[];
}

export class ApiUnavailableError extends Error {
  constructor() {
    super("api unavailable");
    this.name = "ApiUnavailableError";
  }
}

const TIMEOUT_MS = 10_000;

export function apiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.INTERNAL_API_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
}

export function platformOrigin(env: Record<string, string | undefined> = process.env): string {
  return `${env.APP_PROTOCOL ?? "http"}://${env.APP_ROOT_DOMAIN ?? "localhost:3000"}`;
}

export async function callApi<T = unknown>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; cookie?: string | null; ip?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { origin: platformOrigin(), accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.ip && opts.ip !== "unknown") headers["x-forwarded-for"] = opts.ip;
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiUnavailableError();
  }
  let body: T | null = null;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      body = (await res.json()) as T;
    } catch {
      body = null;
    }
  }
  return { status: res.status, body, setCookies: res.headers.getSetCookie() };
}

export interface ParsedSetCookie {
  name: string;
  value: string;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "lax" | "strict" | "none";
  path: string;
}

/** Parses the attributes we set on the API side (name=value; Max-Age; Path; HttpOnly; Secure; SameSite). Expires is not needed. */
export function parseSetCookie(raw: string): ParsedSetCookie | null {
  const [pair, ...attrs] = raw.split(";").map((p) => p.trim());
  const eq = pair?.indexOf("=") ?? -1;
  if (!pair || eq <= 0) return null;
  const out: ParsedSetCookie = { name: pair.slice(0, eq), value: pair.slice(eq + 1), httpOnly: false, secure: false, path: "/" };
  for (const a of attrs) {
    const [k, v = ""] = a.split("=");
    switch (k!.toLowerCase()) {
      case "max-age": {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n)) out.maxAge = n;
        break;
      }
      case "httponly": out.httpOnly = true; break;
      case "secure": out.secure = true; break;
      case "path": out.path = v || "/"; break;
      case "samesite": {
        const s = v.toLowerCase();
        if (s === "lax" || s === "strict" || s === "none") out.sameSite = s;
        break;
      }
    }
  }
  return out;
}
