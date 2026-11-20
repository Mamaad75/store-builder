/** Phase 10 limits and timings. Every number has a database mirror or a test that pins it (see publishing tests). */
export interface PublishLimits {
  /** Canonical UTF-8 JSON bytes of one snapshot: 20 MiB. */
  maxSnapshotBytes: number;
  /** Hard ceiling for how long the store lock may be held by one publish, from acquisition to the end of COMMIT. */
  lockBudgetMs: number;
  /** How long publish may wait for the store lock before giving up with a retryable "busy" result. */
  lockTimeoutMs: number;
  /** Prisma transaction timeout: larger than lockTimeout + lockBudget + commit, so Prisma's own timeout never fires first. */
  txTimeoutMs: number;
  maxPublishesPerHour: number;
  /** Historical (non-current) published slugs per product. A product may hold this + 1 reserved slugs in total. */
  maxHistoricalSlugsPerProduct: number;
  /** Redirects that can be active for one version = sum over its products of (published slugs - 1). */
  maxRedirectsPerVersion: number;
  maxReservedSlugsPerStore: number;
}

export const DEFAULT_PUBLISH_LIMITS: PublishLimits = {
  maxSnapshotBytes: 20 * 1024 * 1024,
  lockBudgetMs: 10_000,
  lockTimeoutMs: 5_000,
  txTimeoutMs: 20_000,
  maxPublishesPerHour: 10,
  maxHistoricalSlugsPerProduct: 5,
  maxRedirectsPerVersion: 2_500,
  maxReservedSlugsPerStore: 10_000,
};

export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const SUBDOMAIN_RESERVATION_DAYS = 30;
export const SUBDOMAIN_RESERVATION_MS = SUBDOMAIN_RESERVATION_DAYS * 24 * 60 * 60 * 1000;
export const MAX_RESERVED_SUBDOMAINS_PER_STORE = 3;
/** Public snapshot cache: 64 MiB of stored snapshot bytes (parsed objects can use 2-4x that in memory). */
export const SNAPSHOT_CACHE_BYTES = 64 * 1024 * 1024;

let overrides: Partial<PublishLimits> = {};
export const publishLimits = (): PublishLimits => ({ ...DEFAULT_PUBLISH_LIMITS, ...overrides });

/** Test seam: lowers or changes limits; an empty object restores the defaults. */
export function setPublishLimitsForTests(o: Partial<PublishLimits>): void {
  overrides = o;
}

export interface PublishHooks {
  /** Called before each budgeted step with its name (tests inject delays here). */
  beforeStep?: (name: string) => Promise<void> | void;
  /** Replaces the clock used for the rate-limit window and version timestamps. */
  now?: () => Date;
  /** Tests only: skips the no-op comparison so identical drafts can create versions (rate-limit and concurrency tests). */
  skipNoOpCheck?: boolean;
}
let hooks: PublishHooks = {};
export const publishHooks = (): PublishHooks => hooks;
export function setPublishHooksForTests(h: PublishHooks): void {
  hooks = h;
}
export const publishNow = (): Date => (hooks.now ? hooks.now() : new Date());
