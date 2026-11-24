import OrderPage from "../../orders/[token]/page";
import { shopMetadata } from "../../_shop";

/**
 * Phase 3.6: the short form of the order link (/o/<token>), used in order SMS, whose tokens are limited in length. Same page, same rules
 * (the token is the secret: never sent on as a referrer).
 */
export const dynamic = "force-dynamic";
export const metadata = { ...shopMetadata("پیگیری سفارش"), referrer: "no-referrer" as const };
export default OrderPage;
