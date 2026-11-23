-- Phase 3.2b (D32b-1): prices linked to the dollar or to 18k gold. EXPAND-only: three new tables, four enums, and the platform settings
-- key list gains "rates". Nothing existing is altered or dropped except that CHECK (re-created with one more value). Reversible: down.sql.

-- CreateEnum
CREATE TYPE "RateCode" AS ENUM ('USD', 'GOLD18');

-- CreateEnum
CREATE TYPE "RateStatus" AS ENUM ('APPLIED', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "PriceLinkKind" AS ENUM ('USD', 'GOLD');

-- CreateEnum
CREATE TYPE "PriceLinkStatus" AS ENUM ('OK', 'OUT_OF_RANGE');

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "code" "RateCode" NOT NULL,
    "rateToman" INTEGER NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "status" "RateStatus" NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceLink" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "target" VARCHAR(64) NOT NULL,
    "kind" "PriceLinkKind" NOT NULL,
    "usdCents" INTEGER,
    "weightMg" INTEGER,
    "wageBp" INTEGER NOT NULL DEFAULT 0,
    "profitBp" INTEGER NOT NULL DEFAULT 0,
    "taxBp" INTEGER NOT NULL DEFAULT 0,
    "stoneToman" INTEGER NOT NULL DEFAULT 0,
    "roundingToman" INTEGER NOT NULL DEFAULT 1000,
    "status" "PriceLinkStatus" NOT NULL DEFAULT 'OK',
    "lastPriceToman" INTEGER,
    "lastRateAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivePrice" (
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "target" VARCHAR(64) NOT NULL,
    "priceToman" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LivePrice_pkey" PRIMARY KEY ("productId","target")
);

-- CreateIndex
CREATE INDEX "ExchangeRate_code_status_createdAt_idx" ON "ExchangeRate"("code", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExchangeRate_status_createdAt_idx" ON "ExchangeRate"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PriceLink_storeId_idx" ON "PriceLink"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceLink_productId_target_key" ON "PriceLink"("productId", "target");

-- CreateIndex
CREATE INDEX "LivePrice_storeId_idx" ON "LivePrice"("storeId");

-- AddForeignKey
ALTER TABLE "PriceLink" ADD CONSTRAINT "PriceLink_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceLink" ADD CONSTRAINT "PriceLink_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivePrice" ADD CONSTRAINT "LivePrice_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Database-level guarantees (the application validates the same rules first).
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_rate_positive" CHECK ("rateToman" > 0);
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_source_format" CHECK ("source" ~ '^[a-z][a-z0-9_]{0,19}$');
ALTER TABLE "PriceLink" ADD CONSTRAINT "PriceLink_target_matches" CHECK ("target" = COALESCE("variantId", '-'));
ALTER TABLE "PriceLink" ADD CONSTRAINT "PriceLink_kind_fields" CHECK (
  ("kind" = 'USD' AND "usdCents" BETWEEN 1 AND 100000000 AND "weightMg" IS NULL)
  OR ("kind" = 'GOLD' AND "weightMg" BETWEEN 1 AND 10000000 AND "usdCents" IS NULL)
);
ALTER TABLE "PriceLink" ADD CONSTRAINT "PriceLink_bp_range" CHECK ("wageBp" BETWEEN 0 AND 10000 AND "profitBp" BETWEEN 0 AND 10000 AND "taxBp" BETWEEN 0 AND 3000);
ALTER TABLE "PriceLink" ADD CONSTRAINT "PriceLink_money_range" CHECK ("stoneToman" BETWEEN 0 AND 1000000000 AND ("lastPriceToman" IS NULL OR "lastPriceToman" BETWEEN 1 AND 1000000000));
ALTER TABLE "PriceLink" ADD CONSTRAINT "PriceLink_rounding_step" CHECK ("roundingToman" IN (1, 100, 1000, 10000));
ALTER TABLE "LivePrice" ADD CONSTRAINT "LivePrice_price_range" CHECK ("priceToman" BETWEEN 0 AND 1000000000);

-- Platform settings: the new "rates" group.
ALTER TABLE "PlatformSetting" DROP CONSTRAINT "PlatformSetting_key_known";
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_key_known" CHECK ("key" IN ('sms', 'payment', 'ai', 'rates'));
