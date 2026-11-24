import type { SuspendStoreInput, SuspensionReason } from "@store-builder/shared/modules/platform/suspension";
import type { PlatformRole } from "../domain/platform.js";

export interface PlatformAdminView {
  userId: string;
  username: string;
  name: string;
  role: PlatformRole;
  grantedAt: Date;
}

export interface PlatformOverview {
  users: number;
  stores: number;
  publishedStores: number;
  products: number;
  customers: number;
}

export interface PlatformStoreRow {
  id: string;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  ownerUsername: string;
  subdomain: string | null;
  products: number;
  createdAt: Date;
  /** ADR 0003: platform suspension (independent of `status`). */
  suspended: boolean;
}

/** ADR 0003 (G2): one suspension of a store, as platform admins see it (internal note included). */
export interface StoreSuspensionView {
  id: string;
  reason: SuspensionReason;
  publicMessage: string;
  internalNote: string;
  merchantStatusAtStart: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  suspendedById: string | null;
  suspendedAt: Date;
  liftedById: string | null;
  liftedAt: Date | null;
  liftNote: string | null;
}

/** ADR 0003 (G2): what store staff see about a suspension: the public message only. */
export interface MerchantSuspensionView {
  suspended: boolean;
  publicMessage: string | null;
  since: Date | null;
}

export interface PlatformAudit {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
}

export interface PlatformRepository {
  roleOf(userId: string): Promise<PlatformRole | null>;
  admins(): Promise<PlatformAdminView[]>;
  countAdmins(): Promise<number>;
  userIdByUsername(username: string): Promise<string | null>;
  /**
   * Grants the role and writes the audit entry in one transaction, under the admins lock. The ACTOR (when not the server command) must still
   * be an admin inside that transaction: a grant that raced the actor's own revocation is refused ("forbidden").
   */
  grant(userId: string, role: PlatformRole, audit: PlatformAudit): Promise<"ok" | "exists" | "forbidden">;
  /** Revokes and audits in one transaction under the same lock: never the last super admin; the actor must still be one. */
  revoke(userId: string, audit: PlatformAudit): Promise<"ok" | "missing" | "last_admin" | "forbidden">;
  overview(): Promise<PlatformOverview>;
  /** Newest first; `before` = createdAt of the last row seen. */
  stores(o: { before?: Date; limit: number }): Promise<PlatformStoreRow[]>;
  /**
   * ADR 0003 (G2). Each in ONE transaction under the store row's lock: the actor must still be a super admin, the open StoreSuspension row and
   * Store.suspendedAt change together, and two audit rows are written (platform: storeId null; store: storeId set, reason code only - never
   * the notes). Nothing here touches the merchant's publishing status.
   */
  suspend(storeId: string, input: SuspendStoreInput, actorId: string): Promise<"ok" | "missing" | "already_suspended" | "forbidden">;
  amend(storeId: string, input: SuspendStoreInput, actorId: string): Promise<"ok" | "missing" | "not_suspended" | "forbidden">;
  restore(storeId: string, note: string, actorId: string): Promise<"ok" | "missing" | "not_suspended" | "forbidden">;
  suspensions(storeId: string): Promise<StoreSuspensionView[] | null>;
  merchantSuspension(storeId: string): Promise<MerchantSuspensionView>;
}
