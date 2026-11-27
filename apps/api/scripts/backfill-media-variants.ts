import { bootstrapJob } from "./bootstrap.js";
import { db } from "../src/lib/db.js";
import { backfillVariants } from "../src/modules/media/backfill.js";

bootstrapJob({ storage: true });

/** Makes the smaller copies of images uploaded before responsive images existed (docs/media.md). Idempotent: run it after deploying, and again if it reports failures. */
backfillVariants()
  .then((r) => {
    console.log(JSON.stringify(r));
    if (r.failed > 0) process.exitCode = 2;
    return db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await db.$disconnect();
    process.exit(1);
  });
