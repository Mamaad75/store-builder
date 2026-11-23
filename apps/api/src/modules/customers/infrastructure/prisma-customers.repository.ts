import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../../../lib/db.js";
import type { ChallengeRow, CustomerRepository, CustomerView, OtpRepository } from "../application/ports.js";

// The only files of the customers module that reach the database. Every query is bound to the store id.

const customerSelect = { id: true, storeId: true, phone: true, name: true, authVersion: true, phoneVerifiedAt: true, lastLoginAt: true, createdAt: true } as const;

export class PrismaCustomerRepository implements CustomerRepository {
  async signIn(storeId: string, phone: string, now: Date): Promise<CustomerView> {
    return db.$transaction(async (tx) => {
      // One row per (store, phone) by the unique index; concurrent first sign-ins converge on it.
      const row = await tx.customer.upsert({ where: { storeId_phone: { storeId, phone } }, create: { storeId, phone }, update: {}, select: { id: true, phoneVerifiedAt: true, passwordHash: true } });
      const firstVerification = row.phoneVerifiedAt === null;
      return tx.customer.update({
        where: { id: row.id },
        data: {
          lastLoginAt: now,
          ...(firstVerification ? { phoneVerifiedAt: now } : {}),
          // An unproven password is dropped and its sessions end (phase 3.3b).
          ...(firstVerification && row.passwordHash ? { passwordHash: null, authVersion: { increment: 1 } } : {}),
        },
        select: customerSelect,
      });
    });
  }

  async credentials(storeId: string, phone: string) {
    const r = await db.customer.findUnique({ where: { storeId_phone: { storeId, phone } }, select: { ...customerSelect, passwordHash: true } });
    if (!r) return null;
    const { passwordHash, ...customer } = r;
    return { customer, passwordHash };
  }

  async register(storeId: string, phone: string, name: string, passwordHash: string, now: Date): Promise<CustomerView | "exists"> {
    return db.$transaction(async (tx) => {
      // Row lock (or the unique index for a new phone) serialises two registrations of one phone.
      const [row] = await tx.$queryRaw<{ id: string; passwordHash: string | null; phoneVerifiedAt: Date | null }[]>`
        SELECT id, "passwordHash", "phoneVerifiedAt" FROM "Customer" WHERE "storeId" = ${storeId} AND phone = ${phone} FOR UPDATE`;
      if (row && (row.passwordHash !== null || row.phoneVerifiedAt !== null)) return "exists" as const;
      if (row) return tx.customer.update({ where: { id: row.id }, data: { passwordHash, name, lastLoginAt: now }, select: customerSelect });
      return tx.customer.create({ data: { storeId, phone, name, passwordHash, lastLoginAt: now }, select: customerSelect });
    });
  }

  async recordLogin(storeId: string, id: string, now: Date): Promise<void> {
    await db.customer.updateMany({ where: { id, storeId }, data: { lastLoginAt: now } });
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

/**
 * Phase 3.3b, for the orders module inside its own transaction: the store's customer for this phone (created when missing, NOT verified),
 * so a guest order belongs to one customer record per phone. A name is filled in only when the record has none.
 */
export async function customerIdForPhoneInTx(scope: { readonly tx: Prisma.TransactionClient }, storeId: string, phone: string, name: string): Promise<string> {
  // One atomic statement: concurrent guest orders with the same phone converge on one row (a read-then-insert upsert would race).
  const [row] = await scope.tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Customer" (id, "storeId", phone, name, "updatedAt") VALUES (${randomBytes(12).toString("hex")}, ${storeId}, ${phone}, ${name}, now())
    ON CONFLICT ("storeId", phone) DO UPDATE SET name = COALESCE("Customer".name, EXCLUDED.name)
    RETURNING id`;
  return row!.id;
}
