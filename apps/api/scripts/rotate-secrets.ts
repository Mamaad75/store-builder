import { parseMasterKeys } from "../src/platform/crypto/envelope.js";
import { rotateSecrets } from "../src/modules/secrets/secrets.api.js";
import { bootstrapJob } from "./bootstrap.js";
import { db } from "../src/lib/db.js";

/**
 * Master key rotation for store secrets (phase 2.4, D24-1). Steps (docs/security.md): add the new key to SECRETS_MASTER_KEYS, make it
 * SECRETS_ACTIVE_KEY_ID, restart EVERY API instance, then run this until it reports remaining: 0; then remove the old key. Idempotent;
 * prints counts only (never key material or values). Exit 2 while anything is left or failed.
 */
bootstrapJob({ storage: false });

async function main() {
  const keys = parseMasterKeys(process.env.SECRETS_MASTER_KEYS, process.env.SECRETS_ACTIVE_KEY_ID);
  if (!keys || "error" in keys) throw new Error(keys ? keys.error : "SECRETS_MASTER_KEYS and SECRETS_ACTIVE_KEY_ID are required");
  const r = await rotateSecrets(keys);
  console.log(JSON.stringify({ event: "secrets.rotated", ...r }));
  if (r.failed > 0 || r.remaining > 0) process.exitCode = 2;
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "rotation failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
