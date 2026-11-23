/**
 * Runs once when the Next.js server process starts. A forbidden or incomplete configuration stops the process with exit code 1
 * instead of letting it serve traffic (decisions D12-8 mail transport, D13-3 environment, phase 2.6 error tracking).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enforceServerEnvAtStartup } = await import("@/lib/server-env");
  enforceServerEnvAtStartup(process.env);
  const { enforceMailTransportAtStartup } = await import("@/modules/auth/mailer");
  enforceMailTransportAtStartup(process.env);
  const { initErrorTracking } = await import("@/lib/error-tracking");
  const problems = initErrorTracking(process.env);
  if (problems.length > 0) {
    console.error(JSON.stringify({ level: "error", event: "startup.refused", reason: "invalid_environment", problems }));
    throw new Error("Startup refused: invalid environment");
  }
}

/** Server-side request errors (render, route handlers) -> error tracking (phase 2.6). Only the route template and the method are sent. */
export async function onRequestError(err: unknown, request: { method: string }, context: { routePath?: string; routeType?: string }): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestError } = await import("@/lib/error-tracking");
  reportRequestError(err, request.method, context);
}
