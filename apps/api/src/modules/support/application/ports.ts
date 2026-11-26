import type { TicketMessageFromT, TicketStatus } from "./types.js";
import type { MessageDecision } from "../domain/ticket.js";

export interface TicketRow {
  id: string;
  storeId: string;
  subject: string;
  status: TicketStatus;
  messageCount: number;
  lastMessageAt: Date;
  createdAt: Date;
}
export interface StaffTicketRow extends TicketRow {
  storeName: string;
}
export interface MessageRow {
  id: string;
  from: TicketMessageFromT;
  /** The merchant's own name for their messages; null for staff (staff are never named to merchants). */
  authorName: string | null;
  body: string;
  createdAt: Date;
}
export interface PlatformAudit {
  actorId: string;
  action: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

/** Every method that takes `storeId` is tenant-scoped: a ticket of another store does not exist for it. `null` = platform staff (any store). */
export interface TicketRepository {
  listForStore(storeId: string, limit: number): Promise<TicketRow[]>;
  listForStaff(f: { status?: TicketStatus; before?: Date; limit: number }): Promise<StaffTicketRow[]>;
  /** One transaction under the store's row lock; "too_many_open" = the store is at its limit of open tickets. */
  create(storeId: string, userId: string, subject: string, body: string, now: Date): Promise<TicketRow | "too_many_open">;
  detail(ticketId: string, storeId: string | null): Promise<{ ticket: StaffTicketRow; messages: MessageRow[] } | null>;
  /** Under the ticket's row lock: `decide` sees the current status and message count; a refusal changes nothing. */
  addMessage(
    ticketId: string,
    storeId: string | null,
    m: { from: TicketMessageFromT; authorId: string; body: string },
    decide: (status: TicketStatus, messageCount: number) => MessageDecision,
    now: Date,
    audit?: PlatformAudit,
  ): Promise<TicketRow | "not_found" | Extract<MessageDecision, { ok: false }>>;
  setStatus(ticketId: string, storeId: string | null, status: TicketStatus, now: Date, audit?: PlatformAudit): Promise<TicketRow | null>;
}
