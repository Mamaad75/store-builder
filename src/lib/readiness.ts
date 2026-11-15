import { db } from "./db";
import { getMediaStorage } from "./storage";

const CHECK_TIMEOUT_MS = 2_000;

async function within<T>(work: () => Promise<T>): Promise<boolean> {
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

export interface Readiness {
  ready: boolean;
  checks: { database: boolean; storage: boolean };
}

/** Is the platform able to serve traffic? The database answers and the object store accepts the application's credentials, 2 s each. */
export async function checkReadiness(): Promise<Readiness> {
  const [database, storage] = await Promise.all([
    within(() => db.$queryRaw`SELECT 1`),
    within(() => getMediaStorage().list("stores/", { limit: 1 })),
  ]);
  return { ready: database && storage, checks: { database, storage } };
}
