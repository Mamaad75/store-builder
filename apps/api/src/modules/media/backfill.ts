import { starterAssetForKey } from "@store-builder/shared/lib/storage/keys";
import { log as appLog } from "../../lib/log.js";
import { getMediaStorage, type MediaStorage } from "../../lib/storage/index.js";
import { listWithoutVariants, markVariantsReadyIfReady } from "./repository.js";
import { storeVariants } from "./service.js";

export interface BackfillReport {
  done: number;
  failed: number;
}

/**
 * Makes the smaller copies of images uploaded before copies existed (READY, no copies yet, wider than the smallest copy). Safe to run at any
 * time and any number of times: an image is only marked after all its copies are stored, a missing object is reported and left as it is, and
 * a picture too small for any copy is never selected. Pages through the table by id, so it is bounded in memory.
 */
export async function backfillVariants(o: { storage?: MediaStorage; log?: (msg: string, err?: unknown) => void; pageSize?: number } = {}): Promise<BackfillReport> {
  const storage = o.storage ?? getMediaStorage();
  const log = o.log ?? ((m: string, e?: unknown) => appLog.error("media.backfill", { step: m, errorClass: e instanceof Error ? e.name : undefined }));
  const report: BackfillReport = { done: 0, failed: 0 };
  let after: string | undefined;
  for (;;) {
    const rows = await listWithoutVariants(after, o.pageSize ?? 100);
    if (rows.length === 0) break;
    for (const m of rows) {
      after = m.id;
      if (starterAssetForKey(m.key) || !m.width) continue; // bundled starter images are static files, not objects
      try {
        const body = await storage.get(m.key);
        if (!body) {
          report.failed++;
          log(`media ${m.id}: its object is missing`);
          continue;
        }
        if (!(await storeVariants(storage, m.key, body, m.width, log))) {
          report.failed++;
          continue;
        }
        await markVariantsReadyIfReady(m.id);
        report.done++;
      } catch (e) {
        report.failed++;
        log(`media ${m.id}: could not make its copies`, e);
      }
    }
  }
  return report;
}
