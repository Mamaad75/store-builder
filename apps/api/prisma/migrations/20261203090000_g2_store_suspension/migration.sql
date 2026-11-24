-- ADR 0003 (G2): platform store suspension, independent of the merchant's publishing status. EXPAND-only. Reversible: down.sql.

CREATE TYPE "SuspensionReason" AS ENUM ('FRAUD', 'PROHIBITED_GOODS', 'PHISHING_OR_IMPERSONATION', 'LEGAL_ORDER', 'PAYMENT_PROVIDER_REQUEST', 'CUSTOMER_COMPLAINTS', 'SECURITY_INCIDENT', 'OTHER');

ALTER TABLE "Store" ADD COLUMN "suspendedAt" TIMESTAMP(3);

CREATE TABLE "StoreSuspension" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reason" "SuspensionReason" NOT NULL,
    "publicMessage" VARCHAR(300) NOT NULL,
    "internalNote" VARCHAR(2000) NOT NULL,
    "merchantStatusAtStart" "StoreStatus" NOT NULL,
    "suspendedById" TEXT,
    "suspendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedById" TEXT,
    "liftedAt" TIMESTAMP(3),
    "liftNote" VARCHAR(2000),
    CONSTRAINT "StoreSuspension_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StoreSuspension_storeId_suspendedAt_idx" ON "StoreSuspension"("storeId", "suspendedAt");

-- At most one open suspension per store.
CREATE UNIQUE INDEX "StoreSuspension_one_open" ON "StoreSuspension"("storeId") WHERE "liftedAt" IS NULL;
-- A public message is required; a lifted row has its lift note and is lifted after it started; an open row has no lift fields.
ALTER TABLE "StoreSuspension" ADD CONSTRAINT "StoreSuspension_shape" CHECK (
  length(btrim("publicMessage")) > 0
  AND (("liftedAt" IS NULL AND "liftNote" IS NULL AND "liftedById" IS NULL) OR ("liftedAt" IS NOT NULL AND "liftNote" IS NOT NULL AND "liftedAt" >= "suspendedAt")));
