-- Phase 3.1 (D31-1, D31-2): platform super-admins, platform settings and secrets, customer accounts per store, one-time sign-in codes.
-- EXPAND only: new tables and a new enum, nothing existing changes. Reverse: down.sql (not applied by Prisma).

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN');

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "userId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL DEFAULT 'SUPER_ADMIN',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" TEXT,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "name" VARCHAR(80),
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "phoneVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" VARCHAR(40) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PlatformSecret" (
    "name" VARCHAR(80) NOT NULL,
    "keyId" VARCHAR(32) NOT NULL,
    "wrappedKey" BYTEA NOT NULL,
    "sealed" BYTEA NOT NULL,
    "hint" VARCHAR(4),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PlatformSecret_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "Customer_storeId_createdAt_idx" ON "Customer"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_storeId_phone_key" ON "Customer"("storeId", "phone");

-- CreateIndex
CREATE INDEX "OtpChallenge_storeId_phone_createdAt_idx" ON "OtpChallenge"("storeId", "phone", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "PlatformSecret_keyId_idx" ON "PlatformSecret"("keyId");

-- AddForeignKey
ALTER TABLE "PlatformAdmin" ADD CONSTRAINT "PlatformAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invariants the application also enforces (defense in depth).
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_phone_format" CHECK ("phone" ~ '^\+989[0-9]{9}$');
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_authVersion_nonneg" CHECK ("authVersion" >= 0);
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_phone_format" CHECK ("phone" ~ '^\+989[0-9]{9}$');
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_attempts_range" CHECK ("attempts" >= 0 AND "attempts" <= 10);
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_codeHash_hex" CHECK ("codeHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_key_known" CHECK ("key" IN ('sms', 'payment', 'ai'));
ALTER TABLE "PlatformSecret" ADD CONSTRAINT "PlatformSecret_name_format" CHECK ("name" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$');
