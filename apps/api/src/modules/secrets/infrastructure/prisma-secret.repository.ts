import { db } from "../../../lib/db.js";
import type { AuditEntry, SealedSecret, SecretRepository, SecretSummary } from "../application/ports.js";

// The only file of the secrets module that reaches the database. Every query is bound to the store id; lists never select the envelope.
// Writes take a per-store transaction lock, so the cap and the audit record cannot be bypassed by concurrent requests.

const lockStore = (tx: Pick<typeof db, "$executeRaw">, storeId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`secrets:${storeId}`}, 0))`;

export class PrismaSecretRepository implements SecretRepository {
  list(storeId: string): Promise<SecretSummary[]> {
    return db.storeSecret.findMany({ where: { storeId }, orderBy: { name: "asc" }, select: { name: true, hint: true, updatedAt: true } });
  }

  get(storeId: string, name: string): Promise<SealedSecret | null> {
    return db.storeSecret.findUnique({ where: { storeId_name: { storeId, name } }, select: { keyId: true, wrappedKey: true, sealed: true } });
  }

  async put(storeId: string, name: string, e: SealedSecret, hint: string | null, o: { limit: number; audit: AuditEntry }): Promise<"ok" | "limit"> {
    return db.$transaction(async (tx) => {
      await lockStore(tx, storeId);
      const exists = (await tx.storeSecret.count({ where: { storeId, name } })) === 1;
      if (!exists && (await tx.storeSecret.count({ where: { storeId } })) >= o.limit) return "limit";
      const data = { keyId: e.keyId, wrappedKey: Buffer.from(e.wrappedKey), sealed: Buffer.from(e.sealed), hint };
      await tx.storeSecret.upsert({ where: { storeId_name: { storeId, name } }, create: { storeId, name, ...data }, update: data });
      await tx.auditEvent.create({ data: { storeId, actorId: o.audit.actorId, action: o.audit.action, targetType: "secret", targetId: name } });
      return "ok";
    });
  }

  async remove(storeId: string, name: string, audit: AuditEntry): Promise<boolean> {
    return db.$transaction(async (tx) => {
      await lockStore(tx, storeId);
      if ((await tx.storeSecret.deleteMany({ where: { storeId, name } })).count !== 1) return false;
      await tx.auditEvent.create({ data: { storeId, actorId: audit.actorId, action: audit.action, targetType: "secret", targetId: name } });
      return true;
    });
  }
}
