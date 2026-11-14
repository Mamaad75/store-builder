import { db } from "../src/lib/db";
import { runMediaCleanup } from "../src/modules/media/cleanup";

/** Idempotent media cleanup (see docs/media.md). Safe to run at any time, e.g. from a scheduler later. */
runMediaCleanup()
  .then((r) => {
    console.log(JSON.stringify(r));
    // A scheduler / monitor sees failures: items that could not be cleaned are retried by the next run, but never ignored.
    if (r.failures > 0) process.exitCode = 2;
    return db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await db.$disconnect();
    process.exit(1);
  });
