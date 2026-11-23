import { db } from "../../../lib/db.js";
import type { ChallengeRow, CustomerRepository, CustomerView, OtpRepository } from "../application/ports.js";

// The only files of the customers module that reach the database. Every query is bound to the store id.

const customerSelect = { id: true, storeId: true, phone: true, name: true, authVersion: true, phoneVerifiedAt: true, lastLoginAt: true, createdAt: true } as const;

export class PrismaCustomerRepository implements CustomerRepository {
  signIn(storeId: string, phone: string, now: Date): Promise<CustomerView> {
    // One row per (store, phone) by the unique index; concurrent first sign-ins converge on it.
    return db.customer.upsert({
      where: { storeId_phone: { storeId, phone } },
      create: { storeId, phone, phoneVerifiedAt: now, lastLoginAt: now },
      update: { lastLoginAt: now },
      select: customerSelect,
    });
  }

  find(storeId: string, id: string): Promise<CustomerView | null> {
    return db.customer.findFirst({ where: { id, storeId }, select: customerSelect });
  }

  list(storeId: string, o: { before?: Date; limit: number }): Promise<CustomerView[]> {
    return db.customer.findMany({
      where: { storeId, ...(o.before ? { createdAt: { lt: o.before } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: o.limit,
      select: customerSelect,
    });
  }

  async bumpAuthVersion(storeId: string, id: string): Promise<void> {
    await db.customer.updateMany({ where: { id, storeId }, data: { authVersion: { increment: 1 } } });
  }
}

export class PrismaOtpRepository implements OtpRepository {
  latest(storeId: string, phone: string): Promise<ChallengeRow | null> {
    return db.otpChallenge.findFirst({
      where: { storeId, phone },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, codeHash: true, attempts: true, createdAt: true, expiresAt: true, consumedAt: true },
    });
  }

  async create(storeId: string, phone: string, codeHash: string, expiresAt: Date): Promise<string> {
    return (await db.otpChallenge.create({ data: { storeId, phone, codeHash, expiresAt }, select: { id: true } })).id;
  }

  async countAttempt(id: string, max: number): Promise<boolean> {
    // Atomic: the condition and the increment are one statement, so parallel guesses cannot pass the limit.
    const r = await db.otpChallenge.updateMany({ where: { id, consumedAt: null, attempts: { lt: max } }, data: { attempts: { increment: 1 } } });
    return r.count === 1;
  }

  async consume(id: string, now: Date): Promise<boolean> {
    return (await db.otpChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: now } })).count === 1;
  }

  async discard(id: string): Promise<void> {
    await db.otpChallenge.deleteMany({ where: { id } });
  }
}

/** db-cleanup job: challenges that expired more than a day ago (nothing can use them any more). */
export async function purgeExpiredChallenges(now = new Date()): Promise<number> {
  return (await db.otpChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 3600 * 1000) } } })).count;
}
