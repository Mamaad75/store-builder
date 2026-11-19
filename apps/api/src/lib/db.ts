import type { Prisma as Client } from "../database/prisma-client.js";

/**
 * The domain modules (ported from the former web app) read the database through this `db`. It is a thin handle onto the ONE Prisma client
 * of the process: the application sets it at start-up (database/prisma-client.ts via the Nest provider) and tests set their own with `useDb`.
 */
let current: Client | null = null;

export function useDb(client: Client): void {
  current = client;
}

export const db: Client = new Proxy({} as Client, {
  // `"$transaction" in client` is how the modules tell the root client from a transaction client: it must see the real client's keys.
  has(_target, prop) {
    return current ? prop in current : false;
  },
  get(_target, prop) {
    if (!current) throw new Error("The database client has not been initialised");
    const value = (current as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(current) : value;
  },
});
