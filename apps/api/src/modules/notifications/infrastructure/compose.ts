import { orderSmsPlatformSchema } from "@store-builder/shared/modules/notifications/order-sms";
import { maskPhone } from "@store-builder/shared/lib/phone";
import { log } from "../../../lib/log.js";
import { KavenegarSms } from "../../../platform/sms/sms.js";
import { createOrderNotificationReader } from "../../orders/orders.api.js";
import { OrderSmsService } from "../application/order-sms.service.js";
import type { SmsPlatform, TemplateSender } from "../application/ports.js";
import { PrismaSmsStore } from "./prisma-sms.repository.js";

/** The platform side the composition reads (the platform module's settings service fits it). */
export interface PlatformSmsSource {
  settings(): Promise<{ sms: { orderSms?: unknown } }>;
  reveal(name: "sms.kavenegar.api_key"): Promise<string | null>;
}

/** Development only: writes the message kind, the template and the masked phone instead of sending (no link: it holds the order token). */
const devLogSender: TemplateSender = {
  async sendTemplate(phone, template, tokens) {
    log.info("order_sms.dev_message", { to: maskPhone(phone), template, order: tokens.token, store: tokens.token10 ?? null });
  },
};

/** Composition of order SMS (phase 3.6): PostgreSQL log, the orders module's reader, Kavenegar with the platform key (or the dev log). */
export function createOrderSmsService(o: {
  authSecret: string;
  storeOrigin: (label: string) => string;
  platform: PlatformSmsSource;
  devLog?: boolean;
  /** Tests: a fake sender. */
  sender?: TemplateSender | null;
  apiBase?: string;
}): OrderSmsService {
  const platform: SmsPlatform = {
    // Read on every event (one small row): switching order SMS off applies at once.
    settings: async () => {
      const r = orderSmsPlatformSchema.safeParse((await o.platform.settings()).sms.orderSms ?? {});
      return r.success ? r.data : orderSmsPlatformSchema.parse({});
    },
    sender: async () => {
      if (o.sender !== undefined) return o.sender;
      if (o.devLog) return devLogSender;
      const apiKey = await o.platform.reveal("sms.kavenegar.api_key").catch(() => null);
      return apiKey ? new KavenegarSms({ apiKey, template: "", apiBase: o.apiBase ?? "https://api.kavenegar.com", timeoutMs: 5000 }) : null;
    },
  };
  return new OrderSmsService(createOrderNotificationReader({ authSecret: o.authSecret, storeOrigin: o.storeOrigin }), platform, new PrismaSmsStore());
}
