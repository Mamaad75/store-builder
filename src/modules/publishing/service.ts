import { z } from "zod";
import { StorefrontBuildError, buildStorefrontData } from "@/modules/storefront/build";
import { DraftStorefrontRepository } from "@/modules/storefront/repository";
import { ConflictError, NotFoundError, ValidationError } from "@/modules/stores/errors";
import { StoreLockBusyError, pgErrorCode, withStoreLock } from "@/modules/stores/mutation";
import { parseStoreId } from "@/modules/stores/service";
import { resolveThemeDefinition } from "@/templates/theme-catalog";
import { LockBudget } from "./budget";
import { findUnstorableText, serializeSnapshot } from "./canonical";
import { publishHooks, publishLimits, publishNow } from "./constants";
import {
  IncompatibleVersionError,
  NoChangesError,
  PublishBusyError,
  PublishDataError,
  PublishTimedOutError,
  ReservedSlugLimitError,
  SlugHistoryLimitError,
  SnapshotTextError,
  SnapshotTooLargeError,
  StoreAlreadyLiveError,
  StoreNotLiveError,
  SubdomainRequiredError,
  VersionAlreadyLiveError,
} from "./errors";
import {
  assertWithinPublishRate,
  findVersionByNumber,
  hasSubdomain,
  insertVersion,
  insertVersionProducts,
  listVersionRows,
  liveContentHash,
  newVersionId,
  nextVersionNumber,
  readStoreState,
  reserveSlugs,
  setLive,
  setOffline,
  versionTemplate,
  type VersionRow,
} from "./repository";


const publishInput = z.object({ expectedDraftRevision: z.coerce.number().int().min(1).max(2_000_000_000) }).strict();

export interface PublishResult {
  versionId: string;
  number: number;
  draftRevision: number;
  snapshotBytes: number;
  contentHash: string;
  /** Lock held from acquisition to the end of COMMIT. */
  lockHeldMs: number;
  /** True when COMMIT-time work pushed the hold past the budget (cannot be cancelled by PostgreSQL; reported and logged). */
  budgetExceeded: boolean;
  buildMs: number;
}

/** Maps database-level outcomes that surface outside the budgeted steps (the COMMIT itself, trigger backstops). */
function mapFailure(e: unknown): unknown {
  if (e instanceof StoreLockBusyError) return new PublishBusyError();
  const code = pgErrorCode(e);
  if (code === "57014" || (e as { code?: string } | null)?.code === "P2028") return new PublishTimedOutError("transaction");
  const msg = String((e as { message?: unknown } | null)?.message ?? "");
  if (msg.includes("RESERVED_SLUG_LIMIT")) return new ReservedSlugLimitError(0, publishLimits().maxReservedSlugsPerStore);
  if (msg.includes("PRODUCT_SLUG_LIMIT")) return new SlugHistoryLimitError([], publishLimits().maxHistoricalSlugsPerProduct);
  return e;
}

/**
 * Publishes the draft as a new immutable version.
 *
 * Consistency: the store row is locked FIRST (no draftRevision bump); every draft writer takes that same lock first, so the
 * draft cannot change while it is read. `expectedDraftRevision` is compared under the lock so the owner publishes what they
 * saw. Everything - version, per-version product index, slug reservations and the live pointer - commits together or not at
 * all, inside a hard lock-hold budget (see LockBudget).
 */
export async function publishStore(ownerId: string, storeId: unknown, input: unknown): Promise<PublishResult> {
  const sid = parseStoreId(storeId);
  const parsed = publishInput.safeParse(input);
  if (!parsed.success) throw new ValidationError({ expectedDraftRevision: ["نسخهٔ پیش‌نویس نامعتبر است"] });
  const expected = parsed.data.expectedDraftRevision;
  const limits = publishLimits();
  const now = publishNow();

  try {
    const { value, heldMs } = await withStoreLock(
      ownerId,
      sid,
      async (ctx) => {
        const budget = new LockBudget(ctx.tx, limits.lockBudgetMs);
        await budget.step("checks", async () => {
          if (ctx.store.draftRevision !== expected) throw new ConflictError(); // the draft changed after the owner looked
          if (!(await hasSubdomain(ctx))) throw new SubdomainRequiredError();
        });
        await budget.step("rate-limit", () => assertWithinPublishRate(ctx, now, limits));

        const t0 = performance.now();
        const source = await budget.step("read-draft", () => new DraftStorefrontRepository(ctx.ownerId, ctx.tx).load(ctx.storeId));
        if (!source) throw new NotFoundError();
        const built = await budget.step("build", async () => {
          try {
            return buildStorefrontData(source);
          } catch (e) {
            if (e instanceof StorefrontBuildError) throw new PublishDataError(e.message);
            throw e;
          }
        });
        const snap = await budget.step("serialize", async () => {
          const bad = findUnstorableText(built.data);
          if (bad) throw new SnapshotTextError(bad);
          const s = serializeSnapshot(built.data);
          if (s.bytes > limits.maxSnapshotBytes) throw new SnapshotTooLargeError(s.bytes, limits.maxSnapshotBytes);
          return s;
        });
        const buildMs = performance.now() - t0;

        // No-op detection compares with the ACTIVE snapshot only (never the highest-numbered version); an unpublished
        // store has no active snapshot, so publishing is always allowed.
        await budget.step("no-op-check", async () => {
          if (publishHooks().skipNoOpCheck) return;
          const live = await liveContentHash(ctx);
          if (live && live === snap.hash) throw new NoChangesError();
        });

        const number = await budget.step("number", () => nextVersionNumber(ctx));
        const versionId = newVersionId();
        await budget.step("insert-version", () => insertVersion(ctx, { id: versionId, number, draftRevision: ctx.store.draftRevision, text: snap.text, hash: snap.hash, bytes: snap.bytes, createdAt: now }));
        await budget.step("insert-products", () => insertVersionProducts(ctx, versionId, built.data.products.map((p) => ({ productId: p.id, slug: p.slug }))));
        await budget.step("reserve-slugs", () => reserveSlugs(ctx, built.data.products.map((p) => ({ id: p.id, name: p.name, slug: p.slug })), limits));
        await budget.step("pointer", () => setLive(ctx, versionId, now));
        await budget.fence();
        return { versionId, number, draftRevision: ctx.store.draftRevision, snapshotBytes: snap.bytes, contentHash: snap.hash, buildMs };
      },
      { lockTimeoutMs: limits.lockTimeoutMs, txTimeoutMs: limits.txTimeoutMs },
    );
    const result: PublishResult = { ...value, lockHeldMs: heldMs, budgetExceeded: heldMs > limits.lockBudgetMs };
    // One structured line per publish (storage / WAL monitoring input; see docs/publishing.md).
    console.info(JSON.stringify({ event: "publish", storeId: sid, version: result.number, snapshotBytes: result.snapshotBytes, buildMs: Math.round(result.buildMs), lockHeldMs: Math.round(result.lockHeldMs), budgetExceeded: result.budgetExceeded }));
    return result;
  } catch (e) {
    throw mapFailure(e);
  }
}

/** Takes the live site offline. All versions are kept. */
export async function unpublishStore(ownerId: string, storeId: unknown): Promise<void> {
  const sid = parseStoreId(storeId);
  try {
    await withStoreLock(ownerId, sid, async (ctx) => {
      if (ctx.store.status !== "PUBLISHED") throw new StoreNotLiveError();
      await setOffline(ctx);
    });
  } catch (e) {
    throw mapFailure(e);
  }
}

const versionNumberSchema = z.coerce.number().int().min(1).max(2_000_000_000);

/**
 * Moves the live pointer to an EXISTING version; never writes, updates or deletes a version.
 *  - "rollback": the store is live; the target may be older or newer than the current one.
 *  - "republish": the store is offline (UNPUBLISHED); brings it back online with that version.
 */
export async function setLiveVersion(ownerId: string, storeId: unknown, input: { versionNumber: unknown; mode: "rollback" | "republish" }): Promise<{ number: number }> {
  const sid = parseStoreId(storeId);
  const n = versionNumberSchema.safeParse(input.versionNumber);
  if (!n.success) throw new NotFoundError();
  const now = publishNow();
  try {
    const { value } = await withStoreLock(ownerId, sid, async (ctx) => {
      const target = await findVersionByNumber(ctx, n.data);
      if (!target) throw new NotFoundError();
      if (input.mode === "rollback") {
        if (ctx.store.status !== "PUBLISHED") throw new StoreNotLiveError();
        if (ctx.store.publishedVersionId === target.id) throw new VersionAlreadyLiveError();
      } else {
        if (ctx.store.status === "PUBLISHED") throw new StoreAlreadyLiveError();
        if (!(await hasSubdomain(ctx))) throw new SubdomainRequiredError();
      }
      // Never put a version live that the current application cannot render (theme removed, unknown schema).
      const tpl = await versionTemplate(ctx, target.id);
      const theme = tpl && typeof tpl.key === "string" && typeof tpl.version === "number" ? resolveThemeDefinition(tpl.key, tpl.version) : null;
      if (!theme) throw new IncompatibleVersionError();
      await setLive(ctx, target.id, now);
      return { number: target.number };
    });
    return value;
  } catch (e) {
    throw mapFailure(e);
  }
}

export interface PublishState {
  status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  draftRevision: number;
  publishedAt: Date | null;
  live: { number: number; draftRevision: number; createdAt: Date; snapshotBytes: number } | null;
  subdomain: string | null;
  /** True when the draft may differ from the live version (draftRevision moved on); the exact answer is computed at publish time. */
  mayHaveUnpublishedChanges: boolean;
}

export async function getPublishState(ownerId: string, storeId: unknown): Promise<PublishState> {
  const s = await readStoreState(ownerId, parseStoreId(storeId));
  if (!s) throw new NotFoundError();
  const live = s.publishedVersion ? { ...s.publishedVersion } : null;
  return {
    status: s.status,
    draftRevision: s.draftRevision,
    publishedAt: s.publishedAt,
    live,
    subdomain: s.domains[0]?.host ?? null,
    mayHaveUnpublishedChanges: s.status !== "PUBLISHED" || !live || s.draftRevision > live.draftRevision,
  };
}

export async function listVersions(ownerId: string, storeId: unknown): Promise<VersionRow[]> {
  const sid = parseStoreId(storeId);
  if (!(await readStoreState(ownerId, sid))) throw new NotFoundError();
  return listVersionRows(ownerId, sid);
}
