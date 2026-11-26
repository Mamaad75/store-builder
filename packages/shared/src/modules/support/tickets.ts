import { z } from "zod";

/**
 * Support requests (tickets) from a store's owner or manager to the platform's staff. Pure rules shared by the API and the pages.
 * OPEN = waiting for the platform; ANSWERED = the platform replied (waiting for the merchant); CLOSED = finished (a reply reopens it).
 */
export const TICKET_STATUSES = ["OPEN", "ANSWERED", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Readonly<Record<TicketStatus, string>> = { OPEN: "در انتظار پشتیبانی", ANSWERED: "پاسخ داده شد", CLOSED: "بسته شد" };

/** Tickets a store may have open at once, and messages one ticket may hold: nobody can grow either without bound. */
export const MAX_OPEN_TICKETS = 5;
export const MAX_TICKET_MESSAGES = 100;
export const SUBJECT_MAX = 120;
export const BODY_MAX = 4000;

const clean = (v: string) => v.normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‎‏‪-‮⁦-⁩]/g, "").trim();
const subject = z.string().transform(clean).pipe(z.string().min(3, "موضوع را کوتاه و روشن بنویسید (حداقل ۳ حرف).").max(SUBJECT_MAX, "موضوع حداکثر ۱۲۰ حرف باشد."));
const body = z.string().transform((v) => clean(v)).pipe(z.string().min(5, "متن پیام را کامل‌تر بنویسید (حداقل ۵ حرف).").max(BODY_MAX, "متن پیام بیش از حد طولانی است (حداکثر ۴۰۰۰ حرف)."));

export const createTicketSchema = z.object({ subject, body }).strict();
export const ticketReplySchema = z.object({ body }).strict();
export const ticketStatusSchema = z.object({ status: z.enum(TICKET_STATUSES) }).strict();
export const ticketListQuerySchema = z.object({ status: z.enum(TICKET_STATUSES).optional(), before: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

export type MessageFrom = "SELLER" | "STAFF";

/** The status after a merchant writes: the platform has to answer again. A closed ticket is reopened by the reply. */
export const afterSellerMessage = (): TicketStatus => "OPEN";
/** The status after staff reply; replying to a closed ticket is refused (reopen it first). */
export const afterStaffMessage = (current: TicketStatus): TicketStatus | null => (current === "CLOSED" ? null : "ANSWERED");
