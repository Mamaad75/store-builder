import { rewrap, type MasterKeys } from "../../../platform/crypto/envelope.js";
import { db } from "../../../lib/db.js";
import { secretContext } from "../domain/secret.js";

export interface RotationResult {
  rewrapped: number;
  /** Distinct records that could not be re-wrapped (unknown old key or damaged): counted once, never printed. */
  failed: number;
  /** Records still not under the active key (failed ones, or ones changed concurrently: run again). */
  remaining: number;
}

/**
 * Master key rotation (D24-1, security review 2026-11-21): re-wraps every data key that is not under the active master key. Pages through
 * the table in key order with a cursor, so failed records are skipped once and never block the rest. Each update is a compare-and-set on
 * the OLD wrapped key bytes: a value changed by the owner in the meantime (new data key, new sealed value) is never overwritten with a
 * stale data key. All API instances must already know the new active key before this runs (docs/security.md).
 */
export async function rotateSecrets(keys: MasterKeys, pageSize = 200): Promise<RotationResult> {
  let rewrapped = 0;
  let failed = 0;
  let cursor: { storeId: string; name: string } | undefined;
  for (;;) {
    // Keyset paging on (storeId, name). Not Prisma's `cursor`: that re-reads the cursor row through the same filter, and a row rotated
    // just before no longer matches it (paging then ended early: caught by the multi-page test).
    const after = cursor ? { OR: [{ storeId: { gt: cursor.storeId } }, { storeId: cursor.storeId, name: { gt: cursor.name } }] } : {};
    const rows = await db.storeSecret.findMany({
      where: { keyId: { not: keys.activeId }, ...after },
      orderBy: [{ storeId: "asc" }, { name: "asc" }],
      take: pageSize,
      select: { storeId: true, name: true, keyId: true, wrappedKey: true, sealed: true },
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      try {
        const next = rewrap(keys, secretContext(r.storeId, r.name), { keyId: r.keyId, wrappedKey: Buffer.from(r.wrappedKey), sealed: Buffer.from(r.sealed) });
        const n = await db.storeSecret.updateMany({
          where: { storeId: r.storeId, name: r.name, keyId: r.keyId, wrappedKey: { equals: r.wrappedKey } },
          data: { keyId: next.keyId, wrappedKey: new Uint8Array(next.wrappedKey) },
        });
        rewrapped += n.count;
      } catch {
        failed += 1;
      }
    }
    const last = rows[rows.length - 1]!;
    cursor = { storeId: last.storeId, name: last.name };
  }
  const remaining = await db.storeSecret.count({ where: { keyId: { not: keys.activeId } } });
  return { rewrapped, failed, remaining };
}
