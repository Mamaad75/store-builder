import { parseMasterKeys } from "../src/platform/crypto/envelope.js";
import { createPlatformSettingsService } from "../src/modules/platform/platform.api.js";
import { createSecretService } from "../src/modules/secrets/secrets.api.js";
import { createPaymentsService } from "../src/modules/orders/orders.api.js";
import { bootstrapJob } from "./bootstrap.js";
import { db } from "../src/lib/db.js";

bootstrapJob({ storage: false });

/**
 * The `payments-reconcile` job (phase 3.5, D35-1), every 5 minutes in the worker: online payments nobody came back for are asked about at
 * Zarinpal and verified when paid, interrupted verifications are resumed, unpaid orders past their deadline expire and give their stock
 * back. Prints one JSON line of counts (never an authority, merchant id or provider text). Unclear attempts (buyer still at the bank, no
 * answer) are normal and retried on the next run, so they do not fail the job; exit 1 = the run itself crashed.
 */
async function main() {
  const keys = parseMasterKeys(process.env.SECRETS_MASTER_KEYS, process.env.SECRETS_ACTIVE_KEY_ID);
  const k = keys && !("error" in keys) ? keys : null;
  const settings = createPlatformSettingsService(k);
  const secrets = createSecretService(k);
  const dev = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  const loop = (v: string | undefined) => (dev && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(v ?? "") ? v : undefined);
  const devBase = loop(process.env.ZARINPAL_DEV_BASE_URL);
  const payments = createPaymentsService({
    // The job hands out no order links and opens no gateway sessions: neither the token key nor the store origin is used.
    authSecret: process.env.AUTH_SECRET ?? "reconcile-job-issues-no-tokens",
    limiter: { consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
    sources: { paymentSettings: async () => (await settings.settings()).payment, reveal: (storeId, name) => (k ? secrets.reveal(storeId, name) : Promise.resolve(null)), secretsReady: () => k !== null },
    storeOrigin: () => "",
    devBaseUrl: devBase,
    devAqayeBaseUrl: loop(process.env.AQAYEPARDAKHT_DEV_BASE_URL),
  });
  const report = await payments.reconcile();
  console.log(JSON.stringify({ event: "payments.reconciled", ...report }));
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.name : "payments reconcile failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
