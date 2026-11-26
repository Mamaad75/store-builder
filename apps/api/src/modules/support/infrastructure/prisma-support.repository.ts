import { db } from "../../../lib/db.js";
import { canOpenAnother, type MessageDecision } from "../domain/ticket.js";
import type { MessageRow, PlatformAudit, StaffTicketRow, TicketRepository, TicketRow } from "../application/ports.js";
import type { TicketMessageFromT, TicketStatus } from "../application/types.js";

// The only file of the support module that reaches the database. Tenant scoping: every query that takes a storeId filters by it.

const TX = { timeout: 10_000, maxWait: 5_000 } as const;
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

const row = (t: { id: string; storeId: string; subject: string; status: TicketStatus; messageCount: number; lastMessageAt: Date; createdAt: Date }): TicketRow => ({
  id: t.id, storeId: t.storeId, subject: t.subject, status: t.status, messageCount: t.messageCount, lastMessageAt: t.lastMessageAt, createdAt: t.createdAt,
});

const platformAudit = (tx: Tx, storeId: string, a: PlatformAudit) =>
  tx.auditEvent.create({ data: { storeId: null, actorId: a.actorId, action: a.action, targetType: "ticket", targetId: a.targetId, metadata: { ...a.metadata, storeId } } });

export class PrismaSupportRepository implements TicketRepository {
  async listForStore(storeId: string, limit: number): Promise<TicketRow[]> {
    return (await db.supportTicket.findMany({ where: { storeId }, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], take: limit })).map(row);
  }

  async listForStaff(f: { status?: TicketStatus; before?: Date; limit: number }): Promise<StaffTicketRow[]> {
    const rows = await db.supportTicket.findMany({
      where: { ...(f.status ? { status: f.status } : {}), ...(f.before ? { lastMessageAt: { lt: f.before } } : {}) },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: f.limit,
      include: { store: { select: { name: true } } },
    });
    return rows.map((t) => ({ ...row(t), storeName: t.store.name }));
  }

  create(storeId: string, userId: string, subject: string, body: string, now: Date): Promise<TicketRow | "too_many_open"> {
    return db.$transaction(async (tx) => {
      // The store's row serialises two simultaneous requests, so the limit of open tickets cannot be passed by racing.
      await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
      const open = await tx.supportTicket.count({ where: { storeId, status: { not: "CLOSED" } } });
      if (!canOpenAnother(open)) return "too_many_open" as const;
      const t = await tx.supportTicket.create({
        data: { storeId, createdById: userId, subject, status: "OPEN", messageCount: 1, lastMessageAt: now, messages: { create: { from: "SELLER", authorId: userId, body, createdAt: now } } },
      });
      return row(t);
    }, TX);
  }

  async detail(ticketId: string, storeId: string | null): Promise<{ ticket: StaffTicketRow; messages: MessageRow[] } | null> {
    const t = await db.supportTicket.findFirst({
      where: { id: ticketId, ...(storeId ? { storeId } : {}) },
      include: { store: { select: { name: true } }, messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!t) return null;
    const authors = [...new Set(t.messages.filter((m) => m.from === "SELLER").map((m) => m.authorId))];
    const users = authors.length ? await db.user.findMany({ where: { id: { in: authors } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      ticket: { ...row(t), storeName: t.store.name },
      messages: t.messages.map((m) => ({ id: m.id, from: m.from, authorName: m.from === "SELLER" ? (names.get(m.authorId) ?? null) : null, body: m.body, createdAt: m.createdAt })),
    };
  }

  addMessage(
    ticketId: string,
    storeId: string | null,
    m: { from: TicketMessageFromT; authorId: string; body: string },
    decide: (status: TicketStatus, messageCount: number) => MessageDecision,
    now: Date,
    audit?: PlatformAudit,
  ): Promise<TicketRow | "not_found" | Extract<MessageDecision, { ok: false }>> {
    return db.$transaction(async (tx) => {
      const cur = await lockTicket(tx, ticketId, storeId);
      if (!cur) return "not_found" as const;
      const d = decide(cur.status, cur.messageCount);
      if (!d.ok) return d;
      await tx.supportTicketMessage.create({ data: { ticketId, from: m.from, authorId: m.authorId, body: m.body, createdAt: now } });
      const t = await tx.supportTicket.update({ where: { id: ticketId }, data: { status: d.status, messageCount: { increment: 1 }, lastMessageAt: now } });
      if (audit) await platformAudit(tx, t.storeId, audit);
      return row(t);
    }, TX);
  }

  setStatus(ticketId: string, storeId: string | null, status: TicketStatus, now: Date, audit?: PlatformAudit): Promise<TicketRow | null> {
    return db.$transaction(async (tx) => {
      const cur = await lockTicket(tx, ticketId, storeId);
      if (!cur) return null;
      const t = await tx.supportTicket.update({ where: { id: ticketId }, data: { status, updatedAt: now } });
      if (audit) await platformAudit(tx, t.storeId, audit);
      return row(t);
    }, TX);
  }
}

/** Locks one ticket row for the rest of the transaction; a ticket of another store is "not found" (never revealed). */
async function lockTicket(tx: Tx, ticketId: string, storeId: string | null): Promise<{ storeId: string; status: TicketStatus; messageCount: number } | null> {
  const rows = await tx.$queryRaw<{ storeId: string; status: TicketStatus; messageCount: number }[]>`
    SELECT "storeId", "status"::text AS "status", "messageCount" FROM "SupportTicket" WHERE id = ${ticketId} FOR UPDATE`;
  const r = rows[0];
  if (!r || (storeId !== null && r.storeId !== storeId)) return null;
  return r;
}
