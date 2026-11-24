/** Public API of the notifications module (phase 3.6): order SMS. The worker composes the service; app.module.ts imports notifications.module.ts. */
export { OrderSmsService, OrderSmsRetryError, type DeliveredEvent } from "./application/order-sms.service.js";
export { createOrderSmsService } from "./infrastructure/compose.js";
