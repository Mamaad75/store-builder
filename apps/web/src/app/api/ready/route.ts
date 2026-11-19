import { platformOnly } from "@/lib/host-guard";
import { log } from "@/lib/log";
import { checkReadiness } from "@/lib/readiness";

export const dynamic = "force-dynamic";

/**
 * Readiness (the load balancer / orchestrator asks "may I send traffic?"). The body names the failing dependency but never an error
 * message, host or secret. Liveness is the cheaper /api/health. Both are platform-host only.
 */
export async function GET(req: Request) {
  const blocked = platformOnly(req);
  if (blocked) return blocked;
  const r = await checkReadiness();
  if (!r.ready) log.warn("readiness.failed", r.checks);
  const label = (ok: boolean) => (ok ? "ok" : "fail");
  return Response.json(
    { status: r.ready ? "ready" : "unavailable", checks: { api: label(r.checks.api), database: label(r.checks.database), storage: label(r.checks.storage) } },
    { status: r.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
