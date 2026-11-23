import type { Prisma } from "@prisma/client";
import type { PlatformSettingGroup } from "@store-builder/shared/modules/platform/settings";
import { db } from "../../../lib/db.js";
import type { Sealed, SettingsAudit, SettingsRepository } from "../application/settings.service.js";

// Platform settings and secrets (phase 3.1). Every write is audited (AuditEvent, storeId null) in the same transaction; lists never
// select an envelope.
export class PrismaSettingsRepository implements SettingsRepository {
  async all(): Promise<Partial<Record<PlatformSettingGroup, unknown>>> {
    const rows = await db.platformSetting.findMany({ select: { key: true, value: true } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async put(group: PlatformSettingGroup, value: unknown, a: SettingsAudit): Promise<void> {
    const json = value as Prisma.InputJsonValue;
    await db.$transaction([
      db.platformSetting.upsert({ where: { key: group }, create: { key: group, value: json, updatedById: a.actorId }, update: { value: json, updatedById: a.actorId } }),
      db.auditEvent.create({ data: { storeId: null, actorId: a.actorId, action: a.action, targetType: "platform_setting", targetId: a.targetId } }),
    ]);
  }

  secrets(): Promise<{ name: string; hint: string | null; updatedAt: Date }[]> {
    return db.platformSecret.findMany({ select: { name: true, hint: true, updatedAt: true }, orderBy: { name: "asc" } });
  }

  secret(name: string): Promise<Sealed | null> {
    return db.platformSecret.findUnique({ where: { name }, select: { keyId: true, wrappedKey: true, sealed: true } });
  }

  async putSecret(name: string, e: Sealed, hint: string | null, a: SettingsAudit): Promise<void> {
    const data = { keyId: e.keyId, wrappedKey: Buffer.from(e.wrappedKey), sealed: Buffer.from(e.sealed), hint, updatedById: a.actorId };
    await db.$transaction([
      db.platformSecret.upsert({ where: { name }, create: { name, ...data }, update: data }),
      db.auditEvent.create({ data: { storeId: null, actorId: a.actorId, action: a.action, targetType: "platform_secret", targetId: a.targetId } }),
    ]);
  }

  async removeSecret(name: string, a: SettingsAudit): Promise<boolean> {
    return db.$transaction(async (tx) => {
      if ((await tx.platformSecret.deleteMany({ where: { name } })).count !== 1) return false;
      await tx.auditEvent.create({ data: { storeId: null, actorId: a.actorId, action: a.action, targetType: "platform_secret", targetId: a.targetId } });
      return true;
    });
  }
}
