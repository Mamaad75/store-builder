import { createInviteSchema, inviteStatus, recoveryRequestSchema, RECOVERY_LINK_HOURS, type InviteStatus } from "@store-builder/shared/modules/platform/pilot";
import { PlatformRateLimitedError, ReauthFailedError, RecoveryRefusedError } from "@store-builder/shared/modules/platform/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { z } from "zod";

/**
 * MVP item 2 (pilot access controls, roadmap §12.3): invitation codes for invite-only registration, and admin-assisted account recovery.
 * Raw codes and recovery tokens exist only in the answer to the super admin (shown once); the database keeps their SHA-256.
 */
export interface InviteRow {
  id: string;
  note: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  usedBy: string | null;
}
export interface PilotAudit {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}
export interface PilotRepository {
  invites(limit: number): Promise<InviteRow[]>;
  /** Creates the invitation and its audit entry in one transaction. */
  createInvite(i: { codeHash: string; note: string; createdById: string | null; expiresAt: Date }, audit: Omit<PilotAudit, "targetId">): Promise<string>;
  /** Revokes an unused, unrevoked invitation and audits it in one transaction; false = none such. */
  revokeInvite(id: string, at: Date, audit: PilotAudit): Promise<boolean>;
  userByUsername(username: string): Promise<{ id: string; username: string; name: string; createdAt: Date; recoveredAt: Date | null; isPlatformAdmin: boolean; stores: number } | null>;
  passwordHashOf(userId: string): Promise<string | null>;
  isPlatformAdmin(userId: string): Promise<boolean>;
  /**
   * One transaction: revokes the user's open recovery link, creates the new one, replaces the password with an unusable one, increments
   * authVersion (every session ends), stamps recoveredAt and writes the audit entry. false = the user does not exist.
   */
  recover(userId: string, r: { tokenHash: string; reason: string; createdById: string; expiresAt: Date; passwordHash: string; now: Date }, audit: PilotAudit): Promise<boolean>;
  audit(a: PilotAudit): Promise<void>;
}
export interface PilotDeps {
  hashPassword(p: string): Promise<string>;
  verifyPassword(hash: string, p: string): Promise<boolean>;
  limit(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  /** Cryptographically random, base64url: `bytes` random bytes (infrastructure: node:crypto). */
  random(bytes: number): string;
  sha256(value: string): string;
  /** The platform's own origin, e.g. https://example.ir (the recovery page lives on the platform host). */
  platformOrigin: string;
  clock?: () => Date;
}

const ID_RE = /^[a-z0-9]{1,64}$/;

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input ?? {});
  if (!r.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of r.error.issues) (fieldErrors[String(i.path[0] ?? "_")] ??= []).push(i.message);
    throw new ValidationError(fieldErrors);
  }
  return r.data;
}

export class PilotAccessService {
  constructor(
    private readonly repo: PilotRepository,
    private readonly deps: PilotDeps,
  ) {}

  private now(): Date {
    return this.deps.clock?.() ?? new Date();
  }

  async invites(): Promise<(Omit<InviteRow, "usedAt" | "revokedAt"> & { status: InviteStatus })[]> {
    const now = this.now();
    return (await this.repo.invites(100)).map(({ usedAt, revokedAt, ...i }) => ({ ...i, status: inviteStatus({ usedAt, revokedAt, expiresAt: i.expiresAt }, now) }));
  }

  /** Issues a single-use code. `actorId` null = the server command. The code is returned ONCE (with a ready sign-up link). */
  async createInvite(actorId: string | null, input: unknown): Promise<{ id: string; code: string; url: string; expiresAt: Date }> {
    const { note, days } = parse(createInviteSchema, input);
    const code = this.deps.random(16);
    const expiresAt = new Date(this.now().getTime() + days * 86_400_000);
    const id = await this.repo.createInvite({ codeHash: this.deps.sha256(code), note, createdById: actorId, expiresAt }, { actorId, action: "platform.invite_created", targetType: "invite", metadata: { days } });
    return { id, code, url: `${this.deps.platformOrigin}/register?invite=${encodeURIComponent(code)}`, expiresAt };
  }

  async revokeInvite(actorId: string, id: string): Promise<void> {
    if (!ID_RE.test(id) || !(await this.repo.revokeInvite(id, this.now(), { actorId, action: "platform.invite_revoked", targetType: "invite", targetId: id }))) throw new NotFoundError();
  }

  async findUser(username: unknown) {
    const u = typeof username === "string" ? await this.repo.userByUsername(username.trim().toLowerCase()) : null;
    if (!u) throw new NotFoundError();
    return u;
  }

  /**
   * Roadmap §12.3: SUPER_ADMIN only (guard), the admin's own password re-entered (D-20, rate-limited, failures audited), a reason and the
   * attestation that the owner's identity was checked OUTSIDE the application. Never for another platform admin or oneself.
   */
  async recover(actor: { id: string }, targetUserId: string, input: unknown): Promise<{ url: string; expiresAt: Date }> {
    const req = parse(recoveryRequestSchema, input);
    const rl = await this.deps.limit(`recovery:admin:${actor.id}`);
    if (!rl.allowed) throw new PlatformRateLimitedError(rl.retryAfterSeconds);
    const hash = await this.repo.passwordHashOf(actor.id);
    if (!hash || !(await this.deps.verifyPassword(hash, req.adminPassword))) {
      await this.repo.audit({ actorId: actor.id, action: "security.reauth_failed", targetType: "user", targetId: ID_RE.test(targetUserId) ? targetUserId : "invalid" });
      throw new ReauthFailedError();
    }
    if (!ID_RE.test(targetUserId)) throw new NotFoundError();
    if (targetUserId === actor.id) throw new RecoveryRefusedError("self");
    if (await this.repo.isPlatformAdmin(targetUserId)) throw new RecoveryRefusedError("target_admin");
    const token = this.deps.random(32);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + RECOVERY_LINK_HOURS * 3600_000);
    // The old password stops working at once (an unknowable random one), so a compromised account is closed until the link is used.
    const passwordHash = await this.deps.hashPassword(this.deps.random(32));
    const ok = await this.repo.recover(
      targetUserId,
      { tokenHash: this.deps.sha256(token), reason: req.reason, createdById: actor.id, expiresAt, passwordHash, now },
      { actorId: actor.id, action: "platform.account_recovered", targetType: "user", targetId: targetUserId, metadata: { reason: req.reason, identityVerifiedOutOfBand: true } },
    );
    if (!ok) throw new NotFoundError();
    return { url: `${this.deps.platformOrigin}/recover?token=${token}`, expiresAt };
  }
}
