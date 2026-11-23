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
}
