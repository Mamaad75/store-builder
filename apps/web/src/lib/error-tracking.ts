import { createErrorReporter, DsnError, NO_REPORTER, parseDsn, type ErrorReporter } from "@store-builder/shared/observability/error-report";
import { log } from "@/lib/log";

/**
 * Error tracking of the web server (phase 2.6): server-side render and route-handler errors (Next's `onRequestError`, see
 * src/instrumentation.ts) go to the same self-hosted GlitchTip as the API. Off when ERROR_TRACKING_DSN is empty; a value that is set but
 * invalid stops the server at startup in every environment (like the API). Reports carry the route TEMPLATE
 * (with its `[param]` placeholders) and the method only: never the URL, headers, cookies or the request body.
 */
type Env = Record<string, string | undefined>;

let reporter: ErrorReporter = NO_REPORTER;

export function errorTrackingProblems(env: Env): string[] {
  const raw = (env.ERROR_TRACKING_DSN ?? "").trim();
  if (!raw) return [];
  const problems: string[] = [];
  try {
    parseDsn(raw);
  } catch (e) {
    if (!(e instanceof DsnError)) throw e;
    problems.push(e.message);
  }
  const environment = (env.ERROR_TRACKING_ENVIRONMENT ?? "").trim();
  if (environment && !/^[a-z0-9_-]{1,32}$/i.test(environment)) problems.push("ERROR_TRACKING_ENVIRONMENT: letters, digits, - and _ (at most 32)");
  const release = (env.APP_RELEASE ?? "").trim();
  if (release && !/^[\w.+-]{1,64}$/.test(release)) problems.push("APP_RELEASE: letters, digits and . + - _ (at most 64)");
  return problems;
}

/** Called once at startup (instrumentation `register`). Returns the problems; the caller stops the process when there are any. */
export function initErrorTracking(env: Env, sender?: typeof fetch): string[] {
  const problems = errorTrackingProblems(env);
  const raw = (env.ERROR_TRACKING_DSN ?? "").trim();
  if (problems.length > 0 || !raw) return problems;
  const dev = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  reporter = createErrorReporter({
    dsn: parseDsn(raw),
    service: "web",
    environment: (env.ERROR_TRACKING_ENVIRONMENT ?? "").trim() || (dev ? "development" : "production"),
    release: (env.APP_RELEASE ?? "").trim() || undefined,
    ...(sender ? { fetch: sender } : {}),
  });
  log.info("error_tracking.enabled", { service: "web" });
  return [];
}

/** Next's navigation signals (notFound, redirect, ...) are thrown errors with a NEXT_ digest: they are not failures. */
const isNavigation = (err: unknown) => typeof (err as { digest?: unknown })?.digest === "string" && /^NEXT_/.test((err as { digest: string }).digest);

export function reportRequestError(err: unknown, method: string, context: { routePath?: string; routeType?: string }): void {
  if (isNavigation(err)) return;
  reporter.capture(err, { route: context.routePath, route_type: context.routeType, method });
}

/** Test seam. */
export function currentErrorReporter(): ErrorReporter {
  return reporter;
}
