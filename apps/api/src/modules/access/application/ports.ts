import type { StaffRole, StoreRole } from "@store-builder/shared/modules/access/permissions";
import type { StoreAccessFacts } from "../domain/access.js";

/** The resolved access of one request: who acts (actorId), for which owner (ownerId), with which role. */
export interface StoreAccessContext {
  storeId: string;
  ownerId: string;
  actorId: string;
  role: StoreRole;
}

export interface MemberView {
  userId: string;
  username: string;
  name: string;
  role: StoreRole;
  since: Date | null;
}

export interface InvitationView {
  id: string;
  username: string;
  name: string;
  role: StaffRole;
  createdAt: Date;
  expiresAt: Date;
}

export interface MyInvitationView {
  id: string;
  storeId: string;
  storeName: string;
  role: StaffRole;
  invitedBy: string;
  expiresAt: Date;
}

export interface SharedStoreView {
  storeId: string;
  name: string;
  role: StaffRole;
}

export interface AccessRepository {
  /** null = the store does not exist. */
  facts(storeId: string, userId: string): Promise<StoreAccessFacts | null>;
  userIdByUsername(username: string): Promise<string | null>;
  isMember(storeId: string, userId: string): Promise<boolean>;
  /** The owner first, then staff by join date. */
  members(storeId: string): Promise<MemberView[]>;
  invitations(storeId: string, now: Date): Promise<InvitationView[]>;
  /** Members plus pending (unexpired) invitations. */
  staffCount(storeId: string, now: Date): Promise<number>;
  /** Replaces an EXPIRED invitation for the same person; throws DuplicateInvitationError for a pending one. */
  createInvitation(i: { storeId: string; invitedUserId: string; role: StaffRole; invitedById: string; expiresAt: Date }, now: Date): Promise<{ id: string }>;
  myInvitations(userId: string, now: Date): Promise<MyInvitationView[]>;
  /** Atomically consumes an unexpired invitation addressed to `userId` and creates the membership. null = no such invitation. */
  acceptInvitation(id: string, userId: string, now: Date): Promise<{ storeId: string; role: StaffRole } | null | "suspended">;
  /** Deletes an invitation addressed to `userId` (decline). Returns its store, or null. */
  declineInvitation(id: string, userId: string): Promise<{ storeId: string } | null>;
  cancelInvitation(storeId: string, id: string): Promise<boolean>;
  removeMember(storeId: string, userId: string): Promise<boolean>;
  changeRole(storeId: string, userId: string, role: StaffRole): Promise<boolean>;
  sharedStores(userId: string): Promise<SharedStoreView[]>;
}

export interface AuditInput {
  storeId: string | null;
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AuditView {
  id: string;
  action: string;
  actorId: string | null;
  actorUsername: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface AuditRepository {
  record(e: AuditInput): Promise<void>;
  /** Newest first; `before` = cursor (createdAt of the last row seen). */
  list(storeId: string, o: { before?: Date; limit: number }): Promise<AuditView[]>;
}

export class DuplicateInvitationError extends Error {
  constructor() {
    super("an invitation for this person is already pending");
    this.name = "DuplicateInvitationError";
  }
}
