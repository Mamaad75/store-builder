import { Controller, Get, Header, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { DATABASE } from "../config/tokens.js";
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
 * Liveness (`/api/health`: the process answers) and readiness (`/api/ready`: the database answers within 2 s). The readiness probe
 * is single-flight and cached for 2 s. The body names the failing dependency, never an error message, host or secret.
 */
@Controller()
export class HealthController {
  private readonly probe: () => Promise<boolean>;

  constructor(@Inject(DATABASE) database: Database) {
    this.probe = createCachedProbe(() => within(() => database.ping()), { ttlMs: CACHE_TTL_MS });
  }

  @Get("health")
  @Header("Cache-Control", "no-store")
  health() {
    return { status: "ok" };
  }

  @Get("ready")
  @Header("Cache-Control", "no-store")
  async ready(@Res({ passthrough: true }) res: Response) {
    const database = await this.probe();
    if (!database) res.status(503);
    return { status: database ? "ready" : "unavailable", checks: { database: database ? "ok" : "fail" } };
  }
}
