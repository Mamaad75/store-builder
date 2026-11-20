import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { rebuildDomainError } from "@store-builder/shared/errors/registry";
import { ApiUnavailableError, callApi } from "@/lib/api-client";
import { sessionCookieHeader } from "@/lib/session-bff";
import { getClientIp } from "@/lib/client-ip";

/**
 * The only door from the web app to the domain (ADR 0001): every read and write is an HTTP call to the NestJS API with the person's own
 * session cookie. Domain errors come back as instances of the SAME error classes the services throw (see shared/errors/registry), so the
 * pages and actions keep their `instanceof` handling. An invalid session sends the person to /login.
 */
export class ApiHttpError extends Error {
  constructor(readonly status: number) {
    super(`API answered ${status}`);
    this.name = "ApiHttpError";
  }
}
export { ApiUnavailableError };

type Opts = { body?: unknown; raw?: Uint8Array; query?: Record<string, string | undefined> };
const WRITE_TIMEOUT_MS = 30_000;

function unwrap<T>(r: { status: number; body: unknown }): T {
  if (r.status >= 200 && r.status < 300) return (r.body ?? undefined) as T;
  if (r.status === 401) redirect("/login");
  const b = r.body as { errorName?: unknown; payload?: unknown } | null;
  const domain = rebuildDomainError(b?.errorName, b?.payload);
  if (domain) throw domain;
  throw new ApiHttpError(r.status);
}

/** A call made as the signed-in person. */
export async function request<T = void>(method: "GET" | "POST" | "PATCH", path: string, opts: Opts = {}): Promise<T> {
  const cookie = await sessionCookieHeader();
  const ip = getClientIp(await headers());
  return unwrap<T>(await callApi(method, path, { ...opts, cookie, ip, ...(method === "GET" ? {} : { timeoutMs: WRITE_TIMEOUT_MS }) }));
}

export const enc = encodeURIComponent;
