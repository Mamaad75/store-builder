import { normalizeUsername } from "@store-builder/shared/modules/auth/schemas";
import { PlatformAdminConflictError, PlatformForbiddenError } from "@store-builder/shared/modules/platform/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { revokeRefusal, type PlatformRole } from "../domain/platform.js";
import type { PlatformAdminView, PlatformOverview, PlatformRepository, PlatformStoreRow } from "./ports.js";

/**
 * Platform administration (phase 3.1, D31-1). Every method takes the acting super admin (resolved by the guard from the database on each
 * request); grants and revocations are audited in the same transaction. Nothing here can make a user a super admin without an existing
 * super admin: the first one comes from the server-side command.
 */
export class PlatformService {
  constructor(private readonly repo: PlatformRepository) {}

  roleOf(userId: string): Promise<PlatformRole | null> {
    return this.repo.roleOf(userId);
  }

  overview(): Promise<PlatformOverview> {
    return this.repo.overview();
  }

  async stores(q: { before?: unknown; limit?: unknown }): Promise<PlatformStoreRow[]> {
    const limit = q.limit === undefined ? 50 : typeof q.limit === "string" && /^\d{1,3}$/.test(q.limit) ? Number(q.limit) : NaN;
    if (!(limit >= 1 && limit <= 100)) throw new ValidationError({ limit: ["عددی بین ۱ و ۱۰۰"] });
    let before: Date | undefined;
    if (q.before !== undefined) {
      before = typeof q.before === "string" && q.before.length <= 40 ? new Date(q.before) : new Date(NaN);
      if (Number.isNaN(before.getTime())) throw new ValidationError({ before: ["تاریخ نامعتبر است"] });
    }
    return this.repo.stores({ before, limit });
  }

  admins(): Promise<PlatformAdminView[]> {
    return this.repo.admins();
  }

  /** `actorId` null = the server-side command (bootstrap). */
  async grant(actorId: string | null, input: unknown): Promise<{ userId: string }> {
    const raw = (input as { username?: unknown } | null)?.username;
    if (typeof raw !== "string" || raw.length > 64) throw new ValidationError({ username: ["نام کاربری را وارد کنید"] });
    const userId = await this.repo.userIdByUsername(normalizeUsername(raw));
    if (!userId) throw new NotFoundError();
    const r = await this.repo.grant(userId, "SUPER_ADMIN", { actorId, action: "platform.admin_granted", targetType: "user", targetId: userId });
    if (r === "forbidden") throw new PlatformForbiddenError();
    if (r === "exists") throw new PlatformAdminConflictError("already_admin");
    return { userId };
  }

  /** `actorId` null = the server-side command, which may revoke anyone but still never the last super admin. */
  async revoke(actorId: string | null, userId: unknown): Promise<void> {
    if (typeof userId !== "string" || userId.length === 0 || userId.length > 64) throw new NotFoundError();
    // Self-revocation is refused here; "never the last one" is decided by the repository under its lock (concurrent revocations).
    if (actorId && revokeRefusal(actorId, userId, Number.MAX_SAFE_INTEGER) === "self") throw new PlatformAdminConflictError("self");
    const r = await this.repo.revoke(userId, { actorId, action: "platform.admin_revoked", targetType: "user", targetId: userId });
    if (r === "forbidden") throw new PlatformForbiddenError();
    if (r === "missing") throw new NotFoundError();
    if (r === "last_admin") throw new PlatformAdminConflictError("last_admin");
  }
}
