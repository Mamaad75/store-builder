-- Phase 3.2 (D32-1): product variants, stock reservations. EXPAND only: new tables, a new enum and one unique index on "Product"
-- ("storeId", "id") that the new tables reference (tenant-safe foreign keys). Reverse: down.sql (not applied by Prisma).

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "optionsKey" VARCHAR(500) NOT NULL,
    "sku" VARCHAR(64),
    "price" INTEGER NOT NULL,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "ref" VARCHAR(64) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductVariant_storeId_productId_position_idx" ON "ProductVariant"("storeId", "productId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_optionsKey_key" ON "ProductVariant"("productId", "optionsKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_storeId_id_key" ON "ProductVariant"("storeId", "id");

-- CreateIndex
CREATE INDEX "StockReservation_storeId_ref_idx" ON "StockReservation"("storeId", "ref");

-- CreateIndex
CREATE INDEX "StockReservation_status_expiresAt_idx" ON "StockReservation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_id_key" ON "Product"("storeId", "id");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariants the application also enforces (defense in depth). Stock can never go negative: the atomic decrement relies on it.
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_stock_range" CHECK ("stockQuantity" BETWEEN 0 AND 1000000);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_price_nonneg" CHECK ("price" >= 0);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_options_shape" CHECK (jsonb_typeof("options") = 'array' AND jsonb_array_length("options") BETWEEN 1 AND 3);
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_quantity_range" CHECK ("quantity" > 0 AND "quantity" <= 1000);
