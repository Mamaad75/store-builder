import { db } from "@/lib/db";
import { getMediaStorage, newMediaKey, type MediaStorage } from "@/lib/storage";
import { getRateLimiter, rateLimitKey, type RateLimiter } from "@/modules/auth/rate-limit";
import { withStoreLock, withStoreMutation, type StoreLockedContext } from "@/modules/stores/mutation";
import { DraftBusyError, NotFoundError } from "@/modules/stores/errors";
import { StoreRepository } from "@/modules/stores/repository";
import { parseStoreId } from "@/modules/stores/service";
import { setProductImageRow, findProductImageInTx } from "@/modules/products/repository";
import { MAX_MEDIA_BYTES_PER_STORE, MAX_MEDIA_PER_STORE, MEDIA_RULES } from "./limits";
import { MediaInUseError, MediaQuotaError, MediaRateLimitError, MediaStorageError } from "./errors";
import { processImage } from "./process";
import {
  deleteMediaRow,
  findMediaInTx,
  insertPendingMedia,
  isMediaReferenced,
  markMediaDeleting,
  markMediaReady,
  quotaUsage,
  setStoreLogoRow,
  type MediaRow,
} from "./repository";

export interface MediaDeps {
  storage?: MediaStorage;
  limiter?: RateLimiter;
  log?: (msg: string, err?: unknown) => void;
}

export type MediaView = Pick<MediaRow, "id" | "key" | "width" | "height" | "sizeBytes" | "mimeType">;
export type ReleaseOutcome = "deleted" | "kept" | "pending_delete" | "gone";
/** What the never-throwing wrappers report: the release outcome, or "deferred" when it could not even start (the cleanup job will). */
export type BestEffortOutcome = ReleaseOutcome | "deferred";

const defaultLog = (msg: string, err?: unknown) => console.error(`[media] ${msg}`, err instanceof Error ? err.message : "");
const toView = (m: MediaRow): MediaView => ({ id: m.id, key: m.key, width: m.width, height: m.height, sizeBytes: m.sizeBytes, mimeType: m.mimeType });

/**
 * THE upload pipeline (product images and store logo both use it):
 *   ownership -> rate limit -> validate + re-encode (CPU, no locks) ->
 *   [tx, store row locked] quota check + insert PENDING row ->
 *   put object (outside any transaction) ->
 *   [tx] PENDING -> READY.
 * The reservation happens first and under the store lock, so concurrent uploads cannot exceed the quotas, and
 * every object that exists in storage has a committed row. Failures compensate; whatever cannot be compensated
 * is found by the cleanup job (docs/media.md).
 */
export async function uploadMedia(ownerId: string, storeId: unknown, bytes: Buffer, deps: MediaDeps = {}): Promise<MediaView> {
  const sid = parseStoreId(storeId);
  const log = deps.log ?? defaultLog;
  if (!(await new StoreRepository(ownerId).find(sid))) throw new NotFoundError();

  const rl = await (deps.limiter ?? getRateLimiter()).consume(rateLimitKey("media:upload", `${ownerId}:${sid}`), MEDIA_RULES.uploadPerUserStore);
  if (!rl.allowed) throw new MediaRateLimitError(rl.retryAfterSeconds);

  const image = await processImage(bytes);
  const storage = deps.storage ?? getMediaStorage();
  const key = newMediaKey(sid);

  const pending = await withStoreMutation(ownerId, sid, async (ctx) => {
    const usage = await quotaUsage(ctx);
    if (usage.count >= MAX_MEDIA_PER_STORE) throw new MediaQuotaError("count");
    if (usage.bytes + image.sizeBytes > MAX_MEDIA_BYTES_PER_STORE) throw new MediaQuotaError("bytes");
    return insertPendingMedia(ctx, { key, mimeType: image.mimeType, sizeBytes: image.sizeBytes, width: image.width, height: image.height });
  });

  try {
    await storage.put(key, image.buffer, { contentType: image.mimeType });
  } catch (e) {
    // Storage failed. The failure may be ambiguous (the write can have succeeded before the error was reported), so
    // try to delete the object too, then release the reservation. Whatever cannot be undone is left PENDING for cleanup.
    await discard(ownerId, sid, pending.id, key, storage, log, true);
    throw new MediaStorageError({ cause: e });
  }

  try {
    const ok = await withStoreMutation(ownerId, sid, (ctx) => markMediaReady(ctx, pending.id));
    if (!ok) throw new Error("reservation vanished");
  } catch (e) {
    // Database failed after the object was stored: remove object and row if we can; otherwise cleanup will.
    await discard(ownerId, sid, pending.id, key, storage, log, true);
    throw e;
  }
  return toView({ ...pending, status: "READY" });
}

/** Best effort compensation; never throws. The row is only removed once the object is known to be gone. */
async function discard(ownerId: string, storeId: string, id: string, key: string, storage: MediaStorage, log: NonNullable<MediaDeps["log"]>, deleteObject: boolean) {
  if (deleteObject) {
    try {
      await storage.delete(key);
    } catch (e) {
      log("could not delete object of a failed upload; cleanup will retry", e);
      return; // keep the PENDING row: it is what lets cleanup find (and later remove) the object
    }
  }
  try {
    await withStoreMutation(ownerId, storeId, (ctx) => deleteMediaRow(ctx, id, "PENDING"));
  } catch (e) {
    log("could not remove the reservation of a failed upload; cleanup will", e);
  }
}

async function loadReadyMedia(ctx: Parameters<typeof findMediaInTx>[0], mediaId: string) {
  const media = await findMediaInTx(ctx, mediaId);
  // Missing, foreign (other store/owner) and not-READY media are indistinguishable.
  if (!media || media.status !== "READY") throw new NotFoundError();
  return media;
}

/** Points the product at an uploaded image of the SAME store, then releases the image it replaced. */
export async function attachProductImage(ownerId: string, storeId: unknown, productId: string, mediaId: string, deps: MediaDeps = {}): Promise<void> {
  const sid = parseStoreId(storeId);
  const previous = await withStoreMutation(ownerId, sid, async (ctx) => {
    await loadReadyMedia(ctx, mediaId);
    const cur = await findProductImageInTx(ctx, productId);
    if (!cur) throw new NotFoundError();
    if (cur.imageId === mediaId) return null;
    await setProductImageRow(ctx, productId, mediaId);
    return cur.imageId;
  });
  if (previous) await releaseMediaBestEffort(ownerId, sid, previous, deps);
}

/** Detaches first (a transaction), then tries to delete the now-unreferenced image. */
export async function detachProductImage(ownerId: string, storeId: unknown, productId: string, deps: MediaDeps = {}): Promise<void> {
  const sid = parseStoreId(storeId);
  const previous = await withStoreMutation(ownerId, sid, async (ctx) => {
    const cur = await findProductImageInTx(ctx, productId);
    if (!cur) throw new NotFoundError();
    if (cur.imageId) await setProductImageRow(ctx, productId, null);
    return cur.imageId;
  });
  if (previous) await releaseMediaBestEffort(ownerId, sid, previous, deps);
}

export async function setStoreLogo(ownerId: string, storeId: unknown, mediaId: string, deps: MediaDeps = {}): Promise<void> {
  const sid = parseStoreId(storeId);
  const previous = await withStoreMutation(ownerId, sid, async (ctx) => {
    await loadReadyMedia(ctx, mediaId);
    const r = await setStoreLogoRow(ctx, mediaId);
    if (!r) throw new NotFoundError();
    return r.previous;
  });
  if (previous && previous !== mediaId) await releaseMediaBestEffort(ownerId, sid, previous, deps);
}

export async function removeStoreLogo(ownerId: string, storeId: unknown, deps: MediaDeps = {}): Promise<void> {
  const sid = parseStoreId(storeId);
  const previous = await withStoreMutation(ownerId, sid, async (ctx) => {
    const r = await setStoreLogoRow(ctx, null);
    if (!r) throw new NotFoundError();
    return r.previous;
  });
  if (previous) await releaseMediaBestEffort(ownerId, sid, previous, deps);
}

/**
 * Physical deletion of an UNREFERENCED media, in three steps that are each safe to repeat:
 *  1. [tx, store locked] verify it is READY and unreferenced, mark it DELETING (tombstone; no new reference can
 *     be attached to a non-READY row)
 *  2. delete the object (idempotent)
 *  3. [tx] delete the row
 * If step 2 fails the row stays DELETING and cleanup retries; if the process dies between 2 and 3 the same
 * happens. Referenced media is never deleted: "kept". Never throws for storage problems.
 */
export function releaseMedia(ownerId: string, storeId: unknown, mediaId: string, deps: MediaDeps = {}): Promise<ReleaseOutcome> {
  return releaseWith(inMutation, ownerId, parseStoreId(storeId), mediaId, deps);
}

/**
 * The same release for the CLEANUP job: identical rules and idempotence, but under a lock-only transaction, so a background
 * reclaim never bumps a store's draftRevision (which would make an owner's open form stale for no visible change).
 */
export function reclaimMedia(ownerId: string, storeId: unknown, mediaId: string, deps: MediaDeps = {}): Promise<ReleaseOutcome> {
  return releaseWith(inLock, ownerId, parseStoreId(storeId), mediaId, deps);
}

type RunLocked = <T>(ownerId: string, storeId: string, fn: (ctx: StoreLockedContext) => Promise<T>) => Promise<T>;
const inMutation: RunLocked = (ownerId, storeId, fn) => withStoreMutation(ownerId, storeId, fn);
const inLock: RunLocked = async (ownerId, storeId, fn) => (await withStoreLock(ownerId, storeId, fn)).value;

async function releaseWith(run: RunLocked, ownerId: string, sid: string, mediaId: string, deps: MediaDeps): Promise<ReleaseOutcome> {
  const storage = deps.storage ?? getMediaStorage();
  const log = deps.log ?? defaultLog;

  const marked = await run(ownerId, sid, async (ctx) => {
    const media = await findMediaInTx(ctx, mediaId);
    if (!media) return "gone" as const;
    if (media.status === "DELETING") return media; // a previous attempt did not finish: finish it
    if (media.status !== "READY") return "kept" as const; // PENDING belongs to a running upload
    if (await isMediaReferenced(ctx, media)) return "kept" as const;
    if (!(await markMediaDeleting(ctx, media.id))) return "kept" as const;
    return media;
  });
  if (typeof marked === "string") return marked;

  try {
    await storage.delete(marked.key);
  } catch (e) {
    log("object delete failed; row stays DELETING for cleanup", e);
    return "pending_delete";
  }
  try {
    await run(ownerId, sid, (ctx) => deleteMediaRow(ctx, marked.id, "DELETING"));
  } catch (e) {
    log("row delete failed after the object was removed; cleanup will finish it", e);
    return "pending_delete";
  }
  return "deleted";
}

/**
 * For code that runs AFTER a media/product/page mutation has already committed (the old image is now unreferenced), and for
 * compensation paths. The committed change is the truth, so this NEVER throws: a failure (store busy, database error) is logged
 * as one structured, greppable line and reported as "deferred". Nothing is lost: the image stays READY/DELETING and the
 * cleanup job (`pnpm media:cleanup`: reclaim of unreferenced READY media, finishing of DELETING rows) removes it.
 */
export async function releaseMediaBestEffort(ownerId: string, storeId: unknown, mediaId: string, deps: MediaDeps = {}): Promise<BestEffortOutcome> {
  try {
    return await releaseMedia(ownerId, storeId, mediaId, deps);
  } catch (e) {
    const log = deps.log ?? defaultLog;
    log(
      JSON.stringify({ event: "media.release_failed", storeId: String(storeId), mediaId, reason: e instanceof DraftBusyError ? "store_busy" : "error", recovery: "pnpm media:cleanup" }),
      e,
    );
    return "deferred";
  }
}

/** Strict variant: referenced media is an error instead of "kept". */
export async function deleteMedia(ownerId: string, storeId: unknown, mediaId: string, deps: MediaDeps = {}): Promise<ReleaseOutcome> {
  const outcome = await releaseMedia(ownerId, storeId, mediaId, deps);
  if (outcome === "kept") {
    const sid = parseStoreId(storeId);
    const media = await withStoreMutation(ownerId, sid, (ctx) => findMediaInTx(ctx, mediaId));
    if (media && media.status === "READY") throw new MediaInUseError();
  }
  return outcome;
}

export async function getMediaForStore(ownerId: string, storeId: unknown, mediaId: string): Promise<MediaView | null> {
  const sid = parseStoreId(storeId);
  const m = await db.media.findFirst({ where: { id: mediaId, storeId: sid, store: { ownerId }, status: "READY" }, select: { id: true, key: true, width: true, height: true, sizeBytes: true, mimeType: true } });
  return m;
}
