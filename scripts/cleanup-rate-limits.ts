import { cleanupResetTokens } from "../src/modules/auth/account";
import { cleanupExpiredBuckets } from "../src/modules/auth/rate-limit";
import { db } from "../src/lib/db";

// Intended for cron / a scheduled job (see docs/deployment.md). Also removes expired and used password-reset tokens.
Promise.all([cleanupExpiredBuckets(1000), cleanupResetTokens()])
  .then(([buckets, tokens]) => console.log(`Deleted ${buckets} expired rate-limit buckets and ${tokens} expired or used password-reset tokens`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
