/**
 * Runs once when the Next.js server process starts. A forbidden mail transport configuration (decision D12-8) stops the process
 * with exit code 1 instead of silently logging password-reset links in production.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enforceMailTransportAtStartup } = await import("@/modules/auth/mailer");
  enforceMailTransportAtStartup(process.env);
}
