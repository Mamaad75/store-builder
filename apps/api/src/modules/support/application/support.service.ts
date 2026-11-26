import { createTicketSchema, ticketListQuerySchema, ticketReplySchema, ticketStatusSchema } from "@store-builder/shared/modules/support/tickets";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { TOO_MANY_OPEN_MESSAGE, decideSellerMessage, decideStaffMessage } from "../domain/ticket.js";
import type { TicketRepository } from "./ports.js";

const ID_RE = /^[a-z0-9]{1,64}$/;
const fieldErrors = (e: { issues: { path: PropertyKey[]; message: string }[] }) => {
  const out: Record<string, string[]> = {};
  for (const i of e.issues) (out[String(i.path[0] ?? "form")] ??= []).push(i.message);
  return out;
};
function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ValidationError(fieldErrors(r.error));
  return r.data;
}
const known = (id: string) => {
  if (!ID_RE.test(id)) throw new NotFoundError();
  return id;
};

const LIST_LIMIT = 100;

/** The merchant's side: the support requests of ONE store (the caller's, from the access guard). */
export class SupportService {
  constructor(
    private readonly repo: TicketRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  list(a: { storeId: string }) {
    return this.repo.listForStore(a.storeId, LIST_LIMIT);
  }

  async open(a: { storeId: string; actorId: string }, body: unknown) {
    const input = parse(createTicketSchema, body);
    const row = await this.repo.create(a.storeId, a.actorId, input.subject, input.body, this.clock());
    if (row === "too_many_open") throw new ValidationError({ subject: [TOO_MANY_OPEN_MESSAGE] });
    return row;
  }

  async get(a: { storeId: string }, ticketId: string) {
    const d = await this.repo.detail(known(ticketId), a.storeId);
    if (!d) throw new NotFoundError();
    return d;
  }

  async reply(a: { storeId: string; actorId: string }, ticketId: string, body: unknown) {
    const input = parse(ticketReplySchema, body);
    const r = await this.repo.addMessage(known(ticketId), a.storeId, { from: "SELLER", authorId: a.actorId, body: input.body }, (...args) => decideSellerMessage(args[1]), this.clock());
    if (r === "not_found") throw new NotFoundError();
    if ("ok" in r) throw new ValidationError({ [r.field]: [r.message] });
    return r;
  }

  async close(a: { storeId: string }, ticketId: string): Promise<void> {
    if (!(await this.repo.setStatus(known(ticketId), a.storeId, "CLOSED", this.clock()))) throw new NotFoundError();
  }
}

/** The platform staff's side: every store's requests. */
export class StaffSupportService {
  constructor(
    private readonly repo: TicketRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(query: unknown) {
    const q = parse(ticketListQuerySchema, query ?? {});
    const before = q.before ? new Date(q.before) : undefined;
    if (before && Number.isNaN(before.getTime())) throw new ValidationError({ before: ["تاریخ نامعتبر است"] });
    return this.repo.listForStaff({ status: q.status, before, limit: q.limit ?? 50 });
  }

  async get(ticketId: string) {
    const d = await this.repo.detail(known(ticketId), null);
    if (!d) throw new NotFoundError();
    return d;
  }

  async reply(staffId: string, ticketId: string, body: unknown) {
    const input = parse(ticketReplySchema, body);
    const id = known(ticketId);
    const r = await this.repo.addMessage(id, null, { from: "STAFF", authorId: staffId, body: input.body }, decideStaffMessage, this.clock(), { actorId: staffId, action: "platform.ticket_replied", targetId: id, metadata: {} });
    if (r === "not_found") throw new NotFoundError();
    if ("ok" in r) throw new ValidationError({ [r.field]: [r.message] });
    return r;
  }

  async setStatus(staffId: string, ticketId: string, body: unknown): Promise<void> {
    const { status } = parse(ticketStatusSchema, body);
    const id = known(ticketId);
    const r = await this.repo.setStatus(id, null, status, this.clock(), { actorId: staffId, action: "platform.ticket_status", targetId: id, metadata: { status } });
    if (!r) throw new NotFoundError();
  }
}
