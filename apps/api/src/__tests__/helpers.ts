import type { ApiConfig } from "../config/env.js";
import type { Database } from "../database/database.js";
import { JsonLogger } from "../logging/json-logger.js";

export const testConfig: ApiConfig = {
  nodeEnv: "test",
  appEnv: "test",
  production: false,
  host: "127.0.0.1",
  port: 0,
  databaseUrl: "postgresql://u:p@localhost:5432/db",
  rootDomain: "localhost:3000",
  protocol: "http",
  trustProxyHops: 0,
  allowedOrigins: ["http://localhost:3000"],
  bodyLimitBytes: 1024 * 64,
  storage: null,
  rateLimitBackend: "postgres" as const,
  authSecret: "test-secret-test-secret-test-secret-1234",
  sessionMaxAgeSeconds: 7 * 24 * 60 * 60,
  // a fixed TEST-ONLY master key (32 bytes); production keys come from SECRETS_MASTER_KEYS
  secrets: { activeId: "test1", keys: new Map([["test1", Buffer.alloc(32, 7)]]) },
  secureCookies: false,
  observability: { metrics: null, errorTracking: null },
};

export function fakeDb(ok = true): Database & { pings: number } {
  const db = {
    pings: 0,
    async ping() {
      db.pings++;
      if (!ok) throw new Error("secret-host.internal refused");
    },
    async close() {},
  };
  return db;
}

export function capture() {
  const lines: string[] = [];
  return { lines, logger: new JsonLogger((_l, line) => lines.push(line)) };
}

/** Ports fetch() refuses ("bad port"): a random listen port can land on one, which made HTTP tests flaky. */
export const FETCH_BLOCKED_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

/** Starts an app on a random loopback port that fetch() accepts; returns the app and its base URL. */
export async function listenFetchable<A extends { listen(port: number, host: string): Promise<unknown>; getUrl(): Promise<string>; close(): Promise<void> }>(make: () => Promise<A>): Promise<{ app: A; base: string }> {
  for (;;) {
    const app = await make();
    await app.listen(0, "127.0.0.1");
    const base = (await app.getUrl()).replace("[::1]", "127.0.0.1");
    if (!FETCH_BLOCKED_PORTS.has(Number(new URL(base).port))) return { app, base };
    await app.close();
  }
}
