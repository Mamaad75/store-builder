import { Inject, Injectable } from "@nestjs/common";
import { PRISMA_CLIENT } from "../config/tokens.js";
import type { UserRecord, UserRepository } from "../auth/ports.js";
import type { Prisma } from "./prisma-client.js";
import { PLATFORM_SETTING_DEFAULTS, registrationSettingsSchema } from "@store-builder/shared/modules/platform/settings";

class InviteInvalid extends Error {}

const SELECT = { id: true, username: true, name: true, passwordHash: true, authVersion: true } as const;

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly db: Prisma) {}

  async create(data: { name: string; username: string; passwordHash: string }, invite?: { codeHash: string; now: Date }): Promise<UserRecord | null | "invite_invalid"> {
    try {
      if (!invite) return await this.db.user.create({ data, select: SELECT });
      return await this.db.$transaction(async (tx) => {
        const user = await tx.user.create({ data, select: SELECT });
        // Single use under concurrency: the row is locked by the first redeemer; a second one re-checks "usedAt IS NULL" after it commits.
        const n = await tx.registrationInvite.updateMany({
          where: { codeHash: invite.codeHash, usedAt: null, revokedAt: null, expiresAt: { gt: invite.now } },
          data: { usedAt: invite.now, usedByUserId: user.id },
        });
        if (n.count !== 1) throw new InviteInvalid();
        return user;
      });
    } catch (e) {
      if (e instanceof InviteInvalid) return "invite_invalid";
      if ((e as { code?: string })?.code === "P2002") return null; // unique index on username (the invitation stays unused)
      throw e;
    }
  }
  async recoveredAt(id: string): Promise<Date | null> {
    return (await this.db.user.findUnique({ where: { id }, select: { recoveredAt: true } }))?.recoveredAt ?? null;
  }
  async registrationMode(): Promise<"invite" | "open"> {
    const row = await this.db.platformSetting.findUnique({ where: { key: "registration" }, select: { value: true } });
    const r = registrationSettingsSchema.safeParse(row?.value);
    return (r.success ? r.data : PLATFORM_SETTING_DEFAULTS.registration).mode; // unreadable or missing = the fail-closed default
  }
  async redeemRecovery(tokenHash: string, passwordHash: string, now: Date): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const link = await tx.accountRecovery.findFirst({ where: { tokenHash, usedAt: null, revokedAt: null, expiresAt: { gt: now } }, select: { id: true, userId: true } });
      if (!link) return false;
      const n = await tx.accountRecovery.updateMany({ where: { id: link.id, usedAt: null, revokedAt: null }, data: { usedAt: now } });
      if (n.count !== 1) return false; // consumed concurrently
      await tx.user.update({ where: { id: link.userId }, data: { passwordHash, authVersion: { increment: 1 } } });
      await tx.auditEvent.create({ data: { storeId: null, actorId: link.userId, action: "account.recovery_completed", targetType: "user", targetId: link.userId } });
      return true;
    });
  }
  findByUsername(username: string) {
    return this.db.user.findUnique({ where: { username }, select: SELECT });
  }
  findById(id: string) {
    return this.db.user.findUnique({ where: { id }, select: SELECT });
  }
  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.db.user.update({ where: { id }, data: { passwordHash, authVersion: { increment: 1 } } });
  }
  async bumpAuthVersion(id: string): Promise<void> {
    await this.db.user.update({ where: { id }, data: { authVersion: { increment: 1 } } });
  }
}
