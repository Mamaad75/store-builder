import type { Prisma } from "@prisma/client";
import { pgErrorCode } from "@/modules/stores/mutation";
import { publishHooks } from "./constants";
import { PublishTimedOutError } from "./errors";

const IDLE_BACKSTOP_MARGIN_MS = 2_000;

/**
 * Enforces the lock-hold budget. Started when the store lock is acquired. EVERY step goes through `step`, which
 *  1. runs the test hook (delay injection),
 *  2. refuses to start when the budget is already spent (the transaction rolls back and releases the lock),
 *  3. sets `statement_timeout` to the REMAINING budget, so PostgreSQL itself cancels a statement that would overrun,
 *  4. re-checks the clock afterwards (CPU-only steps have no statement to cancel).
 * `fence` is the last call before COMMIT.
 *
 * What is and is not bounded (verified on PostgreSQL 16, see docs/publishing.md "Lock-hold guarantees"):
 *  - every statement: cancelled by PostgreSQL at the remaining budget (`statement_timeout`), then the transaction rolls back;
 *  - application-side (CPU) steps and the gaps between statements: checked after the step / before the next one; they cannot be
 *    pre-empted, but a stalled application is ended by the server (`idle_in_transaction_session_timeout`, see `begin`);
 *  - deferred constraint/trigger work: `settleDeferred` runs it as an explicit statement BEFORE the fence, where
 *    `statement_timeout` does apply (at COMMIT it would not: verified, a 4 s deferred trigger ran to completion under a 1 s timeout);
 *  - the COMMIT itself (WAL flush, and a synchronous-standby wait if one is ever configured) is NOT cancellable. It is
 *    measured and reported (`PublishResult.lockHeldMs` / `budgetExceeded`) and gated by the worst-case timing test.
 * So the budget is a hard bound up to the commit fence and a measured, not enforced, bound for the commit itself.
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

  /**
   * Server-side backstop against a stalled application: if the connection sits idle inside this transaction (holding the store
   * lock) for budget + 2 s, PostgreSQL terminates the session, which rolls the transaction back and releases the lock. The
   * normal budget checks always fire first (they run as soon as the application is responsive).
   */
  async begin(): Promise<void> {
    const ms = Math.ceil(this.totalMs + IDLE_BACKSTOP_MARGIN_MS);
    await this.tx.$queryRaw`SELECT set_config('idle_in_transaction_session_timeout', ${`${ms}ms`}, true)`;
  }

  /**
   * Runs any deferrable constraint / trigger work NOW, as a budgeted statement, instead of at COMMIT where it could not be
   * cancelled. The publish path has none today (a test pins that); this keeps it true if a future migration adds one.
   */
  async settleDeferred(): Promise<void> {
    await this.step("deferred-work", () => this.tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`);
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
