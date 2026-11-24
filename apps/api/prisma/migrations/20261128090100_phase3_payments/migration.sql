-- Phase 3.5 (D35-1), part 2 of 2: online payment attempts and the payment deadline of online orders. EXPAND-only. Reversible: down.sql.

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'VERIFYING', 'PAID', 'FAILED', 'EXPIRED', 'REFUND_REQUIRED');
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentDeadline" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "sandbox" BOOLEAN NOT NULL,
    "authority" VARCHAR(40) NOT NULL,
    "amountRial" BIGINT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "claimedAt" TIMESTAMP(3),
    "verifySentAt" TIMESTAMP(3),
    "merchantFingerprint" VARCHAR(64) NOT NULL,
    "returnKeyHash" VARCHAR(64) NOT NULL,
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checks" INTEGER NOT NULL DEFAULT 0,
    "refId" VARCHAR(40),
    "cardPan" VARCHAR(32),
    "fee" BIGINT,
    "lastCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_authority_key" ON "Payment"("authority");

-- CreateIndex
CREATE INDEX "Payment_storeId_orderId_createdAt_idx" ON "Payment"("storeId", "orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_nextCheckAt_idx" ON "Payment"("status", "nextCheckAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- CHECK constraints ----------
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_authority_shape" CHECK ("authority" ~ '^[AS][0-9A-Za-z]{35}$'),
  ADD CONSTRAINT "Payment_amount_range" CHECK ("amountRial" BETWEEN 1000 AND 1000000000),
  ADD CONSTRAINT "Payment_provider_known" CHECK ("provider" IN ('ZARINPAL')),
  ADD CONSTRAINT "Payment_paid_has_ref" CHECK ("status" NOT IN ('PAID', 'REFUND_REQUIRED') OR ("refId" IS NOT NULL AND "verifiedAt" IS NOT NULL)),
  ADD CONSTRAINT "Payment_hashes_hex" CHECK ("merchantFingerprint" ~ '^[0-9a-f]{64}$' AND "returnKeyHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "Payment_checks_range" CHECK ("checks" >= 0),
  ADD CONSTRAINT "Payment_card_masked" CHECK ("cardPan" IS NULL OR "cardPan" ~ '^[0-9*]{6,32}$');

-- Online orders left from an earlier apply of this migration (rolled back by down.sql, which drops the column) get a deadline back, so
-- re-applying never fails on the CHECK below.
UPDATE "Order" SET "paymentDeadline" = "createdAt" + interval '20 minutes' WHERE "paymentMethod" = 'ONLINE' AND "paymentDeadline" IS NULL;

-- An unpaid order is always an online order with a deadline; cash-on-delivery orders never have one.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_awaiting_is_online" CHECK ("status" <> 'AWAITING_PAYMENT' OR "paymentMethod" = 'ONLINE'),
  ADD CONSTRAINT "Order_deadline_online_only" CHECK (("paymentMethod" = 'ONLINE') = ("paymentDeadline" IS NOT NULL));

-- At most one successful payment per order (a second verified payment for one order would be a double charge).
CREATE UNIQUE INDEX "Payment_one_paid_per_order" ON "Payment"("storeId", "orderId") WHERE "status" = 'PAID';
