import { ORDER_SMS_KINDS, SMS_PER_PHONE_PER_DAY, kindsForEvent, stillRelevant, storeSmsSettingsSchema, type OrderSmsKind } from "@store-builder/shared/modules/notifications/order-sms";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { monthStart, recipientOf, tokensFor } from "../domain/order-sms.js";
import type { OrderReader, SmsPlatform, SmsStore } from "./ports.js";

/** A domain event as the worker delivers it (at least once, in any order). */
export interface DeliveredEvent {
  id: string;
  type: string;
  storeId: string | null;
  payload: unknown;
}

/** Thrown when some SMS of an event failed: the queue retries the event; kinds already SENT are duplicates on the retry. */
export class OrderSmsRetryError extends Error {
  constructor(public readonly failed: number) {
    super(`order sms failed: ${failed}`);
    this.name = "OrderSmsRetryError";
  }
}

/**
 * Order SMS (phase 3.6, D36-1). The worker hands every order event here; each event leads to zero or more kinds (kindsForEvent). A kind
 * is sent when the platform has order SMS on and a template for it, the store has not turned them off, the recipient has a phone, and the
 * store is under its monthly cap. Every decision is one row keyed by (event, kind): a re-delivered event sends nothing twice.
 */
export class OrderSmsService {
  constructor(
    private readonly orders: OrderReader,
    private readonly platform: SmsPlatform,
    private readonly store: SmsStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async handle(e: DeliveredEvent): Promise<void> {
    const kinds = kindsForEvent(e.type, e.payload);
    const orderId = (e.payload as { orderId?: unknown } | null)?.orderId;
    if (!kinds.length || !e.storeId || typeof orderId !== "string") return;
    const p = await this.platform.settings();
    if (!p.enabled) return; // nothing recorded while the platform has order SMS off
    const storeId = e.storeId;
    const choice = await this.store.choice(storeId);
    const order = await this.orders.get(storeId, orderId);
    if (!order) return;
    const sender = await this.platform.sender();
    let failed = 0;
    for (const kind of kinds) {
      const key = { storeId, eventId: e.id, kind, orderId };
      const template = p.templates[kind];
      const phone = recipientOf(kind) === "merchant" ? choice.merchantPhone : order.phone;
      const tokens = tokensFor(kind, order);
      const why = !template
        ? "no_template"
        : !choice.enabled
          ? "store_off"
          : !phone
            ? "no_phone"
            : !sender
              ? "no_sender"
              : !stillRelevant(kind, order.status)
                ? "stale"
                : tokens === "link_too_long"
                  ? "link_too_long"
                  : null;
      if (why || tokens === "link_too_long") {
        await this.store.skip(key, why ?? "link_too_long");
        continue;
      }
      const now = this.clock();
      const claimed = await this.store.claim(key, { cap: p.monthlyCapPerStore, since: monthStart(now), phone: phone!, perPhonePerDay: SMS_PER_PHONE_PER_DAY, dayStart: new Date(now.getTime() - 86_400_000) });
      if (claimed !== "go") continue;
      try {
        await sender!.sendTemplate(phone!, template, tokens);
        await this.store.mark(e.id, kind, "SENT", null);
      } catch (err) {
        // Only a fixed reason word is kept (SmsSendError.reason), never a message.
        const r = (err as { reason?: unknown } | null)?.reason;
        const reason = typeof r === "string" && /^[a-z_]{1,30}$/.test(r) ? r : "send_failed";
        if (reason === "timeout" || reason === "network") {
          // Review 3.6: the provider may have sent it: counted as sent, never retried (a second SMS is worse than none).
          await this.store.mark(e.id, kind, "SENT", "uncertain");
        } else {
          await this.store.mark(e.id, kind, "FAILED", reason);
          if (reason === "server_error") failed++; // only a temporary provider failure is retried by the queue
        }
      }
    }
    if (failed) throw new OrderSmsRetryError(failed);
  }

  // ---------- the merchant's settings (store access checked by the guard) ----------

  async view(a: { storeId: string }) {
    const [p, c, used] = await Promise.all([this.platform.settings(), this.store.choice(a.storeId), this.store.used(a.storeId, monthStart(this.clock()))]);
    return {
      enabled: c.enabled,
      merchantPhone: c.merchantPhone,
      platformEnabled: p.enabled,
      monthlyCap: p.monthlyCapPerStore,
      usedThisMonth: used,
      /** Which messages the platform has a template for (the others are not sent by anyone). */
      available: ORDER_SMS_KINDS.filter((k: OrderSmsKind) => Boolean(p.templates[k])),
    };
  }

  async save(a: { storeId: string }, body: unknown) {
    const r = storeSmsSettingsSchema.safeParse(body);
    if (!r.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of r.error.issues) (fieldErrors[String(i.path[0] ?? "_")] ??= []).push(i.message);
      throw new ValidationError(fieldErrors);
    }
    await this.store.saveChoice(a.storeId, r.data);
    return this.view(a);
  }
}
