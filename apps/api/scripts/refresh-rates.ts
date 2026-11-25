import { parseMasterKeys } from "../src/platform/crypto/envelope.js";
import { createPlatformSettingsService } from "../src/modules/platform/platform.api.js";
import { createRatesService } from "../src/modules/pricing/pricing.api.js";
import { bootstrapJob } from "./bootstrap.js";
import { resolveAppEnv } from "../src/config/env.js";
import { db } from "../src/lib/db.js";

bootstrapJob({ storage: false });

/**
 * The `rates-refresh` job (phase 3.2b, D32b-1), hourly in the worker: reads the dollar and 18k-gold rates from the configured provider,
 * applies plausible small moves, HOLDS big jumps (and the first automatic rate) for a super admin, and reprices every linked product.
 * Prints one JSON line of counts (never a key, URL or provider error text). Exit 2 = needs a person (stale or held rate, provider failure,
 * implausible reading): the worker's health then raises the alert; exit 1 = the run itself crashed.
 */
async function main() {
  const keys = parseMasterKeys(process.env.SECRETS_MASTER_KEYS, process.env.SECRETS_ACTIVE_KEY_ID);
  // This job only reads the rates settings; an unknown deployment identity is treated as production (the most restrictive).
  const identity = resolveAppEnv(process.env);
  const settings = createPlatformSettingsService(keys && !("error" in keys) ? keys : null, "appEnv" in identity ? identity.appEnv : "production"); // without keys: manual rates still work
  const report = await createRatesService(settings).refresh();
  console.log(JSON.stringify({ event: "rates.refreshed", ...report }));
  if (report.attention) process.exitCode = 2;
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.name : "rates refresh failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
