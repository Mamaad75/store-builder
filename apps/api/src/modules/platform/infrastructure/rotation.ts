import type { ApiConfig } from "../../../config/env.js";
import { db } from "../../../lib/db.js";
import { rewrapSealed } from "../../secrets/secrets.api.js";
import { platformSecretContext } from "../domain/platform.js";

/**
 * Master key rotation for PLATFORM secrets (phase 3.1), run by `pnpm secrets:rotate` together with the store secrets. Few rows: no paging.
 * Each update is a compare-and-set on the old wrapped key (a value changed meanwhile is never overwritten with a stale data key).
 */
export async function rotatePlatformSecrets(keys: NonNullable<ApiConfig["secrets"]>): Promise<{ rewrapped: number; failed: number; remaining: number }> {
  let rewrapped = 0;
  let failed = 0;
  const rows = await db.platformSecret.findMany({ where: { keyId: { not: keys.activeId } }, select: { name: true, keyId: true, wrappedKey: true, sealed: true } });
  for (const r of rows) {
    try {
      const next = rewrapSealed(keys, platformSecretContext(r.name), r);
      const n = await db.platformSecret.updateMany({ where: { name: r.name, keyId: r.keyId, wrappedKey: { equals: r.wrappedKey } }, data: { keyId: next.keyId, wrappedKey: new Uint8Array(next.wrappedKey) } });
      rewrapped += n.count;
    } catch {
      failed += 1;
    }
  }
  const remaining = await db.platformSecret.count({ where: { keyId: { not: keys.activeId } } });
  return { rewrapped, failed, remaining };
}
