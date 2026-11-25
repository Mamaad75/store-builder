import { describe, expect, it } from "vitest";
import { createInviteSchema, inviteStatus, recoveryRequestSchema } from "./pilot.js";
import { PLATFORM_SETTING_DEFAULTS, registrationSettingsSchema } from "./settings.js";

describe("pilot access controls (MVP item 2)", () => {
  it("registration is invite-only by default (fail-closed); only invite|open are accepted", () => {
    expect(PLATFORM_SETTING_DEFAULTS.registration).toEqual({ mode: "invite" });
    expect(registrationSettingsSchema.safeParse({ mode: "open" }).success).toBe(true);
    expect(registrationSettingsSchema.safeParse({ mode: "closed" }).success).toBe(false);
  });

  it("invites: 1–30 days, default 7; status from the dates", () => {
    expect(createInviteSchema.parse({})).toEqual({ note: "", days: 7 });
    expect(createInviteSchema.safeParse({ days: 31 }).success).toBe(false);
    expect(createInviteSchema.safeParse({ days: 0 }).success).toBe(false);
    const now = new Date("2026-11-25T12:00:00Z");
    const later = new Date("2026-11-26T12:00:00Z");
    expect(inviteStatus({ usedAt: null, revokedAt: null, expiresAt: later }, now)).toBe("active");
    expect(inviteStatus({ usedAt: null, revokedAt: null, expiresAt: now }, now)).toBe("expired");
    expect(inviteStatus({ usedAt: now, revokedAt: null, expiresAt: later }, now)).toBe("used");
    expect(inviteStatus({ usedAt: null, revokedAt: now, expiresAt: later }, now)).toBe("revoked");
  });

  it("recovery needs the admin's password, a reason of at least 10 characters and the identity attestation", () => {
    const ok = { adminPassword: "x", reason: "تماس تلفنی با صاحب حساب", identityVerified: true };
    expect(recoveryRequestSchema.safeParse(ok).success).toBe(true);
    expect(recoveryRequestSchema.safeParse({ ...ok, identityVerified: false }).success).toBe(false);
    expect(recoveryRequestSchema.safeParse({ ...ok, reason: "کوتاه" }).success).toBe(false);
    expect(recoveryRequestSchema.safeParse({ ...ok, adminPassword: "" }).success).toBe(false);
  });
});
