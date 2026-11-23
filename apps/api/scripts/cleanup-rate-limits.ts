import { cleanupExpiredBuckets } from "../src/lib/rate-limit.js";
import { PrismaOutboxStore } from "../src/platform/outbox/prisma-outbox.store.js";
import { PrismaAuditRepository } from "../src/modules/access/access.api.js";
import { purgeExpiredChallenges } from "../src/modules/customers/customers.api.js";
import { createInventoryService } from "../src/modules/inventory/inventory.api.js";
import { purgeExpiredCarts } from "../src/modules/checkout/checkout.api.js";
import { CART_TTL_DAYS } from "@store-builder/shared/modules/checkout/checkout";
import { bootstrapJob } from "./bootstrap.js";
import { db } from "../src/lib/db.js";

bootstrapJob({ storage: false });

// The `db-cleanup` maintenance job (docs/deployment.md): removes expired rate-limit buckets, audit events older than a year (D23-3)
// and published outbox events past their
// retention (phase 2.2b; unpublished events are never deleted). (Password-reset tokens are no longer created or read since U1.)
async function main() {
  const buckets = await cleanupExpiredBuckets(1000);
  const events = await new PrismaOutboxStore().purgePublished();
  const audit = await new PrismaAuditRepository().purgeOlderThan(); // D23-3: one year
  const otp = await purgeExpiredChallenges(); // phase 3.1: sign-in codes expired more than a day ago
  const held = await createInventoryService().releaseExpired(); // phase 3.2: stock held by abandoned checkouts goes back on sale
  const carts = await purgeExpiredCarts(new Date(), CART_TTL_DAYS); // phase 3.3: carts nobody touched for 30 days
  console.log(`Deleted ${buckets} expired rate-limit buckets, ${events} published outbox events, ${audit} audit events past retention, ${otp} expired sign-in codes and ${carts} abandoned carts; released ${held} expired stock reservations`);
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
