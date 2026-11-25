import { z } from "zod";

/**
 * MVP item 2 (pilot access controls, roadmap §12.3): invitation codes and admin-assisted account recovery. Pure rules shared by the API
 * (validation) and the platform pages (forms).
 */

/** Invitation codes are valid for 1–30 days (default 7) and used once. */
export const INVITE_DEFAULT_DAYS = 7;
export const createInviteSchema = z
  .object({
    note: z.string().trim().max(100).default(""),
    days: z.coerce.number().int().min(1).max(30).default(INVITE_DEFAULT_DAYS),
  })
  .strict();

/** A recovery link is valid for 24 hours and used once; a new one revokes the previous one. */
export const RECOVERY_LINK_HOURS = 24;
export const RECOVERY_REASON_MIN = 10;

/**
 * The super admin re-enters their own password (D-20), gives a reason, and attests that the account owner's identity was verified OUTSIDE
 * the application (phone call, in person: ADR 0005 §18), as required by the pilot recovery decision.
 */
export const recoveryRequestSchema = z
  .object({
    adminPassword: z.string().min(1, "رمز عبور خودتان را وارد کنید").max(128),
    reason: z.string().trim().min(RECOVERY_REASON_MIN, "دلیل را دست‌کم در ۱۰ نویسه بنویسید").max(500),
    identityVerified: z.literal(true, { error: "تأیید کنید که هویت صاحب حساب را بیرون از سامانه بررسی کرده‌اید" }),
  })
  .strict();

export type InviteStatus = "active" | "used" | "expired" | "revoked";
export function inviteStatus(i: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): InviteStatus {
  if (i.usedAt) return "used";
  if (i.revokedAt) return "revoked";
  return i.expiresAt <= now ? "expired" : "active";
}
