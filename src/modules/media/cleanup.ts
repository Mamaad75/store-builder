import { MEDIA_KEY_PREFIX, getMediaStorage, isValidMediaKey, type MediaStorage } from "@/lib/storage";
import { CLEANUP_GRACE_MS } from "./limits";
import { claimExpiredPending, deleteMediaRowIfStatus, existingMediaKeys, listDeletingOlderThan, listPendingOlderThan } from "./repository";

export interface CleanupReport {
  expiredPendingRemoved: number;
  deletingFinished: number;
  orphanObjectsRemoved: number;
  objectsScanned: number;
  failures: number;
}

export interface CleanupOptions {
  storage?: MediaStorage;
  now?: () => Date;
  /** Rows/objects younger than this are never touched (they may belong to an upload in flight). */
  graceMs?: number;
  /** Upper bounds per run, so a huge backlog cannot make one run unbounded. */
  maxRows?: number;
  maxObjects?: number;
  log?: (msg: string, err?: unknown) => void;
}

/**
 * Idempotent, safe to run at any time and concurrently with uploads. Three independent steps:
 *  1. PENDING rows older than the grace period: the upload crashed or its compensation failed. Claim the row
 *     (PENDING -> DELETING, conditional), delete the object (idempotent), then delete the row.
 *  2. DELETING rows older than the grace period: finish a physical delete that failed earlier.
 *  3. Orphan objects: list the bucket under `stores/`; an object older than the grace period that has NO row
 *     (e.g. its store was deleted, which cascades to the rows but cannot reach the object store) is deleted.
 * Why this never deletes an active upload: every object a running upload creates is preceded by a committed
 * row (PENDING, later READY), step 3 only removes objects without any row, and every step ignores anything
 * younger than the grace period (default 1 hour, vastly longer than an upload). Rows and objects that are
 * READY are never touched. A failure on one item is counted and logged and does not stop the run.
 */
export async function runMediaCleanup(opts: CleanupOptions = {}): Promise<CleanupReport> {
  const storage = opts.storage ?? getMediaStorage();
  const now = (opts.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - (opts.graceMs ?? CLEANUP_GRACE_MS));
  const maxRows = opts.maxRows ?? 500;
  const maxObjects = opts.maxObjects ?? 10_000;
  const log = opts.log ?? ((m: string, e?: unknown) => console.error(`[media-cleanup] ${m}`, e instanceof Error ? e.message : ""));
  const report: CleanupReport = { expiredPendingRemoved: 0, deletingFinished: 0, orphanObjectsRemoved: 0, objectsScanned: 0, failures: 0 };

  const finish = async (rows: { id: string; key: string }[], status: "PENDING" | "DELETING", onDone: () => void) => {
    for (const row of rows) {
      try {
        // Claim first: only a row that is still PENDING (not completed meanwhile) becomes a DELETING tombstone.
        if (status === "PENDING" && !(await claimExpiredPending(row.id, cutoff))) continue;
        await storage.delete(row.key);
        if (await deleteMediaRowIfStatus(row.id, "DELETING")) onDone();
      } catch (e) {
        report.failures++;
        log(`could not clean ${status} media ${row.id}`, e);
      }
    }
  };

  await finish(await listPendingOlderThan(cutoff, maxRows), "PENDING", () => report.expiredPendingRemoved++);
  await finish(await listDeletingOlderThan(cutoff, maxRows), "DELETING", () => report.deletingFinished++);

  let token: string | undefined;
  do {
    const page = await storage.list(MEDIA_KEY_PREFIX, { limit: 500, after: token });
    token = page.next;
    const candidates = page.objects.filter((o) => isValidMediaKey(o.key) && o.lastModified < cutoff);
    report.objectsScanned += page.objects.length;
    if (candidates.length > 0) {
      const known = await existingMediaKeys(candidates.map((o) => o.key));
      for (const o of candidates) {
        if (known.has(o.key)) continue;
        try {
          await storage.delete(o.key);
          report.orphanObjectsRemoved++;
        } catch (e) {
          report.failures++;
          log(`could not delete orphan object`, e);
        }
      }
    }
  } while (token && report.objectsScanned < maxObjects);

  return report;
}
