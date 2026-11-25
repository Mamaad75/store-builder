-- MVP item 2 (pilot access controls, roadmap §12.3 / M5): invite-only registration and admin-assisted account recovery. EXPAND-only.
-- Reversible: down.sql. Only SHA-256 hashes of invitation codes and recovery tokens are stored; the raw values are shown once.

-- The registration mode is a platform setting group ("invite" | "open"; the application default is "invite").
ALTER TABLE "PlatformSetting" DROP CONSTRAINT "PlatformSetting_key_known";
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_key_known" CHECK ("key" IN ('sms', 'payment', 'ai', 'rates', 'registration'));

-- When platform support recovered the account (the owner sees a notice on the dashboard).
ALTER TABLE "User" ADD COLUMN "recoveredAt" TIMESTAMP(3);

-- A single-use invitation to register (issued by a SUPER_ADMIN or the server command).
CREATE TABLE "RegistrationInvite" (
    "id" TEXT NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "note" VARCHAR(100) NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "RegistrationInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RegistrationInvite_codeHash_key" ON "RegistrationInvite"("codeHash");
CREATE UNIQUE INDEX "RegistrationInvite_usedByUserId_key" ON "RegistrationInvite"("usedByUserId");
CREATE INDEX "RegistrationInvite_createdAt_idx" ON "RegistrationInvite"("createdAt");
ALTER TABLE "RegistrationInvite" ADD CONSTRAINT "RegistrationInvite_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Used means: a time and a user (or the user was deleted later: the time stays); never both used and revoked; expiry after creation.
ALTER TABLE "RegistrationInvite" ADD CONSTRAINT "RegistrationInvite_shape" CHECK (
  "codeHash" ~ '^[0-9a-f]{64}$'
  AND "expiresAt" > "createdAt"
  AND ("usedByUserId" IS NULL OR "usedAt" IS NOT NULL)
  AND NOT ("usedAt" IS NOT NULL AND "revokedAt" IS NOT NULL));

-- A single-use, short-lived link for a user to set a new password after platform support verified their identity outside the app.
CREATE TABLE "AccountRecovery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "AccountRecovery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountRecovery_tokenHash_key" ON "AccountRecovery"("tokenHash");
CREATE INDEX "AccountRecovery_userId_createdAt_idx" ON "AccountRecovery"("userId", "createdAt");
-- At most one usable link per user (issuing a new one revokes the previous one in the same transaction).
CREATE UNIQUE INDEX "AccountRecovery_one_open" ON "AccountRecovery"("userId") WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;
ALTER TABLE "AccountRecovery" ADD CONSTRAINT "AccountRecovery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountRecovery" ADD CONSTRAINT "AccountRecovery_shape" CHECK (
  "tokenHash" ~ '^[0-9a-f]{64}$'
  AND length(btrim("reason")) >= 10
  AND "expiresAt" > "createdAt"
  AND NOT ("usedAt" IS NOT NULL AND "revokedAt" IS NOT NULL));
