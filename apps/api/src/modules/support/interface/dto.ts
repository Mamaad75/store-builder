import type { MessageRow, StaffTicketRow, TicketRow } from "../application/ports.js";

export const ticket = (t: TicketRow) => ({ id: t.id, subject: t.subject, status: t.status, messageCount: t.messageCount, lastMessageAt: t.lastMessageAt, createdAt: t.createdAt });
const message = (m: MessageRow) => ({ id: m.id, from: m.from, authorName: m.authorName, body: m.body, createdAt: m.createdAt });
export const detail = (d: { ticket: StaffTicketRow; messages: MessageRow[] }) => ({ ...ticket(d.ticket), messages: d.messages.map(message) });
