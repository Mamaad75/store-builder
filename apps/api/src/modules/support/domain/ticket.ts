import { MAX_OPEN_TICKETS, MAX_TICKET_MESSAGES, afterSellerMessage, afterStaffMessage, type TicketStatus } from "@store-builder/shared/modules/support/tickets";

/** What a new message does to a ticket, or why it is refused. Pure: the repository applies it under the ticket's row lock. */
export type MessageDecision = { ok: true; status: TicketStatus } | { ok: false; field: "body"; message: string };

export const FULL_MESSAGE = "این درخواست به سقف پیام‌ها رسیده است. لطفاً یک درخواست تازه ثبت کنید.";
export const CLOSED_FOR_STAFF_MESSAGE = "این درخواست بسته است؛ برای پاسخ، ابتدا آن را دوباره باز کنید.";
export const TOO_MANY_OPEN_MESSAGE = `حداکثر ${MAX_OPEN_TICKETS.toLocaleString("fa-IR")} درخواست باز می‌تواند داشته باشید. پس از بسته شدن یکی، درخواست تازه ثبت کنید.`;

export const canOpenAnother = (openCount: number): boolean => openCount < MAX_OPEN_TICKETS;

/** A merchant's message is accepted in any status (it reopens a closed request); only the message cap can refuse it. */
export function decideSellerMessage(messageCount: number): MessageDecision {
  if (messageCount >= MAX_TICKET_MESSAGES) return { ok: false, field: "body", message: FULL_MESSAGE };
  return { ok: true, status: afterSellerMessage() };
}

export function decideStaffMessage(current: TicketStatus, messageCount: number): MessageDecision {
  const next = afterStaffMessage(current);
  if (next === null) return { ok: false, field: "body", message: CLOSED_FOR_STAFF_MESSAGE };
  if (messageCount >= MAX_TICKET_MESSAGES) return { ok: false, field: "body", message: FULL_MESSAGE };
  return { ok: true, status: next };
}
