import { AlertConfigError, formatAlert, readAlertConfig, sendAlert } from "../src/lib/alert.js";
import { formatLog } from "../src/lib/log.js";

/**
 * `pnpm alert:test`: sends one test message through the configured Bale bot, so the alert channel can be proven on a server
 * (e.g. `$DC run --rm --no-deps scheduler pnpm alert:test`). Exit 0 only when Bale accepted the message. Never prints the token or URL.
 */
async function main(): Promise<number> {
  let cfg;
  try {
    cfg = readAlertConfig(process.env);
  } catch (e) {
    console.error(formatLog("error", "alert.test_failed", { reason: e instanceof AlertConfigError ? e.message : "invalid configuration" }));
    return 1;
  }
  if (!cfg) {
    console.error(formatLog("error", "alert.test_failed", { reason: "BALE_BOT_TOKEN and BALE_CHAT_ID are not set" }));
    return 1;
  }
  try {
    await sendAlert(cfg, formatAlert(cfg.source, "alert.test", { note: "پیام آزمایشی کانال هشدار؛ نیازی به اقدام نیست." }));
    console.info(formatLog("info", "alert.test_sent"));
    return 0;
  } catch (e) {
    console.error(formatLog("error", "alert.test_failed", { reason: e instanceof Error ? e.message : "unknown" }));
    return 1;
  }
}

void main().then((code) => process.exit(code));
