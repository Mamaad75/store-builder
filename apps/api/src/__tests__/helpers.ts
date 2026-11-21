import type { ApiConfig } from "../config/env.js";
import type { Database } from "../database/database.js";
import { JsonLogger } from "../logging/json-logger.js";

export const testConfig: ApiConfig = {
  nodeEnv: "test",
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
