import type { Prisma } from "@prisma/client";
import { pgErrorCode } from "@/modules/stores/mutation";
import { publishHooks } from "./constants";
import { PublishTimedOutError } from "./errors";

/**
 * Enforces the lock-hold budget. Started when the store lock is acquired. EVERY step goes through `step`, which
 *  1. runs the test hook (delay injection),
 *  2. refuses to start when the budget is already spent (the transaction rolls back and releases the lock),
 *  3. sets `statement_timeout` to the REMAINING budget, so PostgreSQL itself cancels a statement that would overrun,
 *  4. re-checks the clock afterwards (CPU-only steps have no statement to cancel).
 * `fence` is the last call before COMMIT. IMPORTANT (verified on PostgreSQL 16): `statement_timeout` does NOT apply to
 * commit-time work (deferred triggers, constraint checks, the WAL flush), so the COMMIT itself cannot be cancelled. The
 * protection is structural - the publish path has no deferred constraints or triggers (a test pins that) - and every
 * publish reports its true lock-hold time INCLUDING the commit (`PublishResult.lockHeldMs` / `budgetExceeded`), which the
 * worst-case timing test gates on.
 */
export class LockBudget {
  private readonly startedAt = performance.now();

  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly totalMs: number,
  ) {}

  elapsedMs(): number {
    return performance.now() - this.startedAt;
  }
  remainingMs(): number {
    return this.totalMs - this.elapsedMs();
  }

  private async arm(name: string): Promise<void> {
    const remaining = this.remainingMs();
    if (remaining <= 0) throw new PublishTimedOutError(name);
    await this.tx.$queryRaw`SELECT set_config('statement_timeout', ${`${Math.max(1, Math.floor(remaining))}ms`}, true)`;
  }

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    await publishHooks().beforeStep?.(name);
    await this.arm(name);
    let out: T;
    try {
      out = await fn();
    } catch (e) {
      if (pgErrorCode(e) === "57014") throw new PublishTimedOutError(name);
      throw e;
    }
    if (this.remainingMs() <= 0) throw new PublishTimedOutError(name);
    return out;
  }

  /** Last check before COMMIT: the budget must not already be spent. */
  async fence(): Promise<void> {
    await publishHooks().beforeStep?.("commit-fence");
    if (this.remainingMs() <= 0) throw new PublishTimedOutError("commit-fence");
  }
}
