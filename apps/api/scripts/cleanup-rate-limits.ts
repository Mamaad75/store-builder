import { cleanupExpiredBuckets } from "../src/lib/rate-limit.js";
import { bootstrapJob } from "./bootstrap.js";
import { db } from "../src/lib/db.js";

bootstrapJob({ storage: false });

// Intended for cron / a scheduled job (see docs/deployment.md): removes expired rate-limit buckets.
// (Password-reset tokens are no longer created or read since U1, ADR 0001.)
cleanupExpiredBuckets(1000)
  .then((buckets) => console.log(`Deleted ${buckets} expired rate-limit buckets`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
