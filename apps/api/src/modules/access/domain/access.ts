import { INVITATION_TTL_DAYS, type StaffRole, type StoreRole } from "@store-builder/shared/modules/access/permissions";

/** What the database says about one user and one store. */
export interface StoreAccessFacts {
  ownerId: string;
  /** The user's staff role, or null when the user is not a member. */
  memberRole: StaffRole | null;
}

/** The user's role in the store: OWNER by Store.ownerId, else the staff row; null = no access at all (treated as "not found"). */
export function roleOf(facts: StoreAccessFacts, userId: string): StoreRole | null {
  if (facts.ownerId === userId) return "OWNER";
  return facts.memberRole;
}

export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export type InviteRefusal = "unknown_user" | "owner" | "already_member" | "self";

/** Who may be invited (D23-2): an existing account that is not the inviter, not the owner and not already staff. */
export function inviteRefusal(o: { inviterId: string; ownerId: string; targetId: string | null; targetIsMember: boolean }): InviteRefusal | null {
  if (!o.targetId) return "unknown_user";
  if (o.targetId === o.inviterId) return "self";
  if (o.targetId === o.ownerId) return "owner";
  if (o.targetIsMember) return "already_member";
  return null;
}
