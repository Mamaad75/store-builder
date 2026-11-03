import { cleanupExpiredBuckets } from "../src/modules/auth/rate-limit";
import { db } from "../src/lib/db";

// Intended for cron / a scheduled job (see docs/deployment.md).
cleanupExpiredBuckets(1000)
  .then((n) => console.log(`Deleted ${n} expired rate-limit buckets`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
