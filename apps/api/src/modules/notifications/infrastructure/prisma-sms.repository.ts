import { createHash } from "node:crypto";
import { isMerchantKind, type OrderSmsKind } from "@store-builder/shared/modules/notifications/order-sms";
import { db } from "../../../lib/db.js";
import type { ClaimOutcome, SmsStore, StoreSmsChoice } from "../application/ports.js";

// Phase 3.6 (D36-1): the only file of the notifications module that reaches the database. No phone number of a shopper is stored here.

const TX = { timeout: 10_000, maxWait: 5_000 } as const;
const phoneHash = (phone: string) => createHash("sha256").update(`sms-recipient|${phone}`, "utf8").digest("hex");
const prismaCode = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);

export class PrismaSmsStore implements SmsStore {
  async choice(storeId: string): Promise<StoreSmsChoice> {
    const [r, store] = await Promise.all([
      db.storeSmsSetting.findUnique({ where: { storeId }, select: { enabled: true, merchantPhone: true } }),
      db.store.findUnique({ where: { id: storeId }, select: { suspendedAt: true } }),
    ]);
    const c = r ?? { enabled: true, merchantPhone: null };
    // ADR 0003 (review G2): no order SMS (they carry the merchant-controlled store name) while the platform suspends the store.
    return store?.suspendedAt ? { ...c, enabled: false } : c;
  }

  async saveChoice(storeId: string, c: StoreSmsChoice): Promise<StoreSmsChoice> {
    return db.storeSmsSetting.upsert({ where: { storeId }, create: { storeId, ...c }, update: c, select: { enabled: true, merchantPhone: true } });
  }

  async claim(
    r: { storeId: string; eventId: string; kind: OrderSmsKind; orderId: string },
    limits: { cap: number; since: Date; phone: string; perPhonePerDay: number; dayStart: Date },
  ): Promise<ClaimOutcome> {
    const recipientHash = phoneHash(limits.phone);
    const audience = isMerchantKind(r.kind) ? "MERCHANT_" : "SHOPPER_";
    return db.$transaction(async (tx) => {
      // Advisory locks (review 3.6: never the Store row, which checkouts' foreign keys share): one store's count and one phone's count at a time.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"sms-store:" + r.storeId}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"sms-phone:" + recipientHash}))`;
      const where = { eventId_kind: { eventId: r.eventId, kind: r.kind } };
      const existing = await tx.smsMessage.findUnique({ where, select: { status: true } });
      if (existing && existing.status !== "FAILED") return "duplicate" as const;
      const skipWith = async (reason: string) => {
        if (!existing) await tx.smsMessage.create({ data: { ...r, recipientHash, status: "SKIPPED", reason } });
        else await tx.smsMessage.update({ where, data: { status: "SKIPPED", reason } });
      };
      const used = await tx.smsMessage.count({ where: { storeId: r.storeId, kind: { startsWith: audience }, createdAt: { gte: limits.since }, status: { in: ["SENT", "PENDING"] } } });
      if (used >= limits.cap) {
        await skipWith("monthly_cap");
        return "capped" as const;
      }
      const toPhone = await tx.smsMessage.count({ where: { recipientHash, createdAt: { gte: limits.dayStart }, status: { in: ["SENT", "PENDING"] } } });
      if (toPhone >= limits.perPhonePerDay) {
        await skipWith("phone_daily_limit");
        return "phone_limit" as const;
      }
      if (existing) await tx.smsMessage.update({ where, data: { status: "PENDING", reason: null, recipientHash, createdAt: new Date() } }); // counted in the month it is sent
      else await tx.smsMessage.create({ data: { ...r, recipientHash, status: "PENDING" } });
      return "go" as const;
    }, TX);
  }

  async skip(r: { storeId: string; eventId: string; kind: OrderSmsKind; orderId: string }, reason: string) {
    try {
      await db.smsMessage.create({ data: { ...r, status: "SKIPPED", reason } });
    } catch (e) {
      if (prismaCode(e) !== "P2002") throw e; // already decided for this event and kind
    }
  }

  async mark(eventId: string, kind: OrderSmsKind, status: "SENT" | "FAILED", reason: string | null) {
    await db.smsMessage.updateMany({ where: { eventId, kind, status: "PENDING" }, data: { status, reason } });
  }

  used(storeId: string, since: Date) {
    return db.smsMessage.count({ where: { storeId, createdAt: { gte: since }, status: { in: ["SENT", "PENDING"] } } });
  }
}
