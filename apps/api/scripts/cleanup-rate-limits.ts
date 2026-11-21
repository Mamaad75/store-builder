import { cleanupExpiredBuckets } from "../src/lib/rate-limit.js";
import { PrismaOutboxStore } from "../src/platform/outbox/prisma-outbox.store.js";
import { PrismaAuditRepository } from "../src/modules/access/access.api.js";
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
  console.log(`Deleted ${buckets} expired rate-limit buckets, ${events} published outbox events and ${audit} audit events past retention`);
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
