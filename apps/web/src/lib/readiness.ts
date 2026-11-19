import { createCachedProbe } from "./cached-probe";
import { callApi } from "./api-client";

const CHECK_TIMEOUT_MS = 3_000;
/**
 * `/api/ready` is reachable from the internet (the runbook checks it through Caddy). The web app holds no database or storage
 * credentials any more (ADR 0001): it is ready when the API answers ready (the API checks the database and the object store itself).
 * Results are shared for this long and concurrent requests share one probe, so request volume never drives upstream probes.
 */
export const READINESS_CACHE_MS = 5_000;

export interface Readiness {
  ready: boolean;
  checks: { api: boolean; database: boolean; storage: boolean };
}

async function probeReadiness(): Promise<Readiness> {
  try {
    const r = await callApi<{ checks?: { database?: string; storage?: string } }>("GET", "/api/ready", { timeoutMs: CHECK_TIMEOUT_MS });
    const database = r.body?.checks?.database === "ok";
    const storage = r.body?.checks?.storage === "ok";
    return { ready: r.status === 200 && database && storage, checks: { api: r.body !== null, database, storage } };
  } catch {
    return { ready: false, checks: { api: false, database: false, storage: false } };
  }
}

/** Cached, single-flight readiness (see READINESS_CACHE_MS). */
export const checkReadiness: () => Promise<Readiness> = createCachedProbe(probeReadiness, { ttlMs: READINESS_CACHE_MS });
