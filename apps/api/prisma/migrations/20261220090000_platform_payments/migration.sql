-- CreateEnum
CREATE TYPE "PlatformPaymentPurpose" AS ENUM ('PURCHASE', 'TOPUP');

-- CreateEnum
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('CREATED', 'PAID', 'FAILED', 'EXPIRED', 'LATE_CREDITED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WalletEntryKind" ADD VALUE 'TOPUP';
ALTER TYPE "WalletEntryKind" ADD VALUE 'REFUND';

-- AlterTable
ALTER TABLE "SubscriptionPurchase" ADD COLUMN     "paymentId" TEXT;

-- CreateTable
CREATE TABLE "PlatformPayment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "PlatformPaymentPurpose" NOT NULL,
    "planId" TEXT,
    "planName" VARCHAR(60),
    "durationDays" INTEGER,
    "priceToman" INTEGER NOT NULL DEFAULT 0,
    "discountToman" INTEGER NOT NULL DEFAULT 0,
    "heldToman" INTEGER NOT NULL DEFAULT 0,
    "amountToman" INTEGER NOT NULL,
    "status" "PlatformPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "sandbox" BOOLEAN NOT NULL,
    "authority" VARCHAR(40),
    "refId" VARCHAR(40),
    "cardPan" VARCHAR(32),
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PlatformPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_authority_key" ON "PlatformPayment"("authority");

-- CreateIndex
CREATE INDEX "PlatformPayment_storeId_createdAt_idx" ON "PlatformPayment"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformPayment_status_nextCheckAt_idx" ON "PlatformPayment"("status", "nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPurchase_paymentId_key" ON "SubscriptionPurchase"("paymentId");

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The database refuses what the code never does: parts that do not add up, a plan payment without its plan, a second open payment for one store.
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_amounts" CHECK (
  "amountToman" > 0 AND "priceToman" >= 0 AND "discountToman" >= 0 AND "heldToman" >= 0
  AND (
    ("purpose" = 'TOPUP' AND "priceToman" = 0 AND "discountToman" = 0 AND "heldToman" = 0 AND "planId" IS NULL)
    OR ("purpose" = 'PURCHASE' AND "planId" IS NOT NULL AND "planName" IS NOT NULL AND "durationDays" IS NOT NULL AND "priceToman" - "discountToman" = "heldToman" + "amountToman")
  )
);
CREATE UNIQUE INDEX "PlatformPayment_one_open_per_store" ON "PlatformPayment"("storeId") WHERE "status" = 'CREATED';
