import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@store-builder/shared/modules/access/audit-labels";

/**
 * Every audit action the API can write has a Persian label in the activity log. A new `Audit("x.y")` / `action: "x.y"` without a label would
 * show to the merchant as a raw code; this test fails first. (Platform-only actions with no store are listed in PLATFORM_ONLY.)
 */
const SRC = join(__dirname, "..");
const PLATFORM_ONLY = new Set(["platform.account_recovered", "platform.admin_granted", "platform.admin_revoked", "platform.invite_created", "platform.invite_revoked", "platform.rate_confirmed", "platform.rate_entered", "platform.secret_deleted", "platform.secret_set", "platform.settings_updated", "platform.plan_created", "platform.plan_updated", "platform.purchase_recorded", "platform.wallet_adjusted", "platform.ticket_replied", "platform.ticket_status"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

describe("audit action labels", () => {
  it("every action written by the API is labelled (or is platform-only)", () => {
    const found = new Set<string>();
    for (const f of files(SRC)) for (const m of readFileSync(f, "utf8").matchAll(/(?:Audit\(|action: |audit\(|AUDIT_[A-Z_]* = )"([a-z_]+\.[a-z_.]+)"/g)) found.add(m[1]!);
    expect(found.size).toBeGreaterThan(40); // the scan really found them
    const missing = [...found].filter((a) => !AUDIT_ACTIONS[a] && !PLATFORM_ONLY.has(a));
    expect(missing).toEqual([]);
  });
});
