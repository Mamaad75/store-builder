import { Controller, Get, Header, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { DATABASE } from "../config/tokens.js";
import { getMediaStorage } from "../lib/storage/index.js";
import type { Database } from "../database/database.js";
import { createCachedProbe } from "./cached-probe.js";

const CHECK_TIMEOUT_MS = 2_000;
const CACHE_TTL_MS = 2_000;

async function within(work: () => Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS)))]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Liveness (`/api/health`: the process answers) and readiness (`/api/ready`: the database and the object store answer within 2 s). The readiness probe
 * is single-flight and cached for 2 s. The body names each failing dependency, never an error message, host or secret.
 */
@Controller()
export class HealthController {
  private readonly probe: () => Promise<{ database: boolean; storage: boolean }>;

  constructor(@Inject(DATABASE) database: Database) {
    // The database answers and the object store accepts the application's credentials, 2 s each, probed together.
    this.probe = createCachedProbe(
      async () => {
        const [db, storage] = await Promise.all([within(() => database.ping()), within(() => getMediaStorage().list("stores/", { limit: 1 }))]);
        return { database: db, storage };
      },
      { ttlMs: CACHE_TTL_MS },
    );
  }

  @Get("health")
  @Header("Cache-Control", "no-store")
  health() {
    return { status: "ok" };
  }

  @Get("ready")
  @Header("Cache-Control", "no-store")
  async ready(@Res({ passthrough: true }) res: Response) {
    const { database, storage } = await this.probe();
    const ready = database && storage;
    if (!ready) res.status(503);
    return { status: ready ? "ready" : "unavailable", checks: { database: database ? "ok" : "fail", storage: storage ? "ok" : "fail" } };
  }
}
