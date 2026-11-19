/**
 * Runs once when the Next.js server process starts. A forbidden or incomplete configuration stops the process with exit code 1
 * instead of letting it serve traffic (decisions D12-8 mail transport, D13-3 environment).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enforceServerEnvAtStartup } = await import("@/lib/server-env");
  enforceServerEnvAtStartup(process.env);
  const { enforceMailTransportAtStartup } = await import("@/modules/auth/mailer");
  enforceMailTransportAtStartup(process.env);
}
