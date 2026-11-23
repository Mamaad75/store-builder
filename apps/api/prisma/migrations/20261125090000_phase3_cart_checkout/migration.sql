-- Phase 3.3 (D33-1): cart, shipping methods, saved addresses, product weight. EXPAND-only: four new tables, one enum, one nullable column
-- on Product and one unique index on Customer. Nothing existing is altered or dropped. Reversible: down.sql.

-- CreateEnum
CREATE TYPE "ShippingKind" AS ENUM ('FLAT', 'WEIGHT', 'PICKUP');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "weightGrams" INTEGER;

-- CreateTable
CREATE TABLE "ShippingMethod" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "kind" "ShippingKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(200) NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL DEFAULT 0,
    "perKg" INTEGER NOT NULL DEFAULT 0,
    "defaultItemGrams" INTEGER NOT NULL DEFAULT 500,
    "provinces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provincePrices" JSONB NOT NULL DEFAULT '[]',
    "freeAbove" INTEGER,
    "codEnabled" BOOLEAN NOT NULL DEFAULT false,
    "codProvinces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "codFee" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "lineKey" VARCHAR(130) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "recipientName" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "province" VARCHAR(32) NOT NULL,
    "city" VARCHAR(40) NOT NULL,
    "line" VARCHAR(250) NOT NULL,
    "postalCode" CHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShippingMethod_storeId_position_idx" ON "ShippingMethod"("storeId", "position");

-- CreateIndex
CREATE INDEX "Cart_storeId_customerId_idx" ON "Cart"("storeId", "customerId");

-- CreateIndex
CREATE INDEX "Cart_updatedAt_idx" ON "Cart"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_tokenHash_key" ON "Cart"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_storeId_id_key" ON "Cart"("storeId", "id");

-- CreateIndex
CREATE INDEX "CartItem_storeId_productId_idx" ON "CartItem"("storeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_lineKey_key" ON "CartItem"("cartId", "lineKey");

-- CreateIndex
CREATE INDEX "CustomerAddress_storeId_customerId_createdAt_idx" ON "CustomerAddress"("storeId", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAddress_storeId_id_key" ON "CustomerAddress"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_storeId_id_key" ON "Customer"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_storeId_productId_id_key" ON "ProductVariant"("storeId", "productId", "id");

-- At most one cart per signed-in customer (a partial index: Prisma cannot express it; guest carts have no customer).
CREATE UNIQUE INDEX "Cart_storeId_customerId_one" ON "Cart"("storeId", "customerId") WHERE "customerId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "ShippingMethod" ADD CONSTRAINT "ShippingMethod_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_storeId_customerId_fkey" FOREIGN KEY ("storeId", "customerId") REFERENCES "Customer"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_storeId_cartId_fkey" FOREIGN KEY ("storeId", "cartId") REFERENCES "Cart"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_storeId_productId_variantId_fkey" FOREIGN KEY ("storeId", "productId", "variantId") REFERENCES "ProductVariant"("storeId", "productId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_storeId_customerId_fkey" FOREIGN KEY ("storeId", "customerId") REFERENCES "Customer"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- CHECK constraints (the application validates first; these are the last line of defence) ----------

ALTER TABLE "Product" ADD CONSTRAINT "Product_weightGrams_range" CHECK ("weightGrams" IS NULL OR "weightGrams" BETWEEN 0 AND 1000000);

ALTER TABLE "ShippingMethod"
  ADD CONSTRAINT "ShippingMethod_name_present" CHECK (length(btrim("name")) >= 1),
  ADD CONSTRAINT "ShippingMethod_money_range" CHECK (
    "price" BETWEEN 0 AND 1000000000 AND "perKg" BETWEEN 0 AND 1000000000 AND "codFee" BETWEEN 0 AND 1000000000
    AND ("freeAbove" IS NULL OR "freeAbove" BETWEEN 0 AND 1000000000)),
  ADD CONSTRAINT "ShippingMethod_grams_range" CHECK ("defaultItemGrams" BETWEEN 0 AND 1000000),
  ADD CONSTRAINT "ShippingMethod_position_range" CHECK ("position" BETWEEN 0 AND 1000),
  ADD CONSTRAINT "ShippingMethod_pickup_free" CHECK ("kind" <> 'PICKUP' OR ("price" = 0 AND "perKg" = 0)),
  ADD CONSTRAINT "ShippingMethod_perkg_weight_only" CHECK ("kind" = 'WEIGHT' OR "perKg" = 0),
  ADD CONSTRAINT "ShippingMethod_provinces_shape" CHECK (
    "provinces" IS NOT NULL AND array_position("provinces", NULL) IS NULL AND cardinality("provinces") <= 31
    AND array_to_string("provinces", ',') ~ '^([a-z]+(-[a-z]+)?(,[a-z]+(-[a-z]+)?)*)?$'),
  ADD CONSTRAINT "ShippingMethod_cod_provinces_shape" CHECK (
    "codProvinces" IS NOT NULL AND array_position("codProvinces", NULL) IS NULL AND cardinality("codProvinces") <= 31
    AND array_to_string("codProvinces", ',') ~ '^([a-z]+(-[a-z]+)?(,[a-z]+(-[a-z]+)?)*)?$'),
  ADD CONSTRAINT "ShippingMethod_province_prices_shape" CHECK (jsonb_typeof("provincePrices") = 'array' AND jsonb_array_length("provincePrices") <= 31);

ALTER TABLE "Cart" ADD CONSTRAINT "Cart_tokenHash_hex" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CartItem"
  ADD CONSTRAINT "CartItem_quantity_range" CHECK ("quantity" BETWEEN 1 AND 1000),
  ADD CONSTRAINT "CartItem_lineKey_matches" CHECK ("lineKey" = "productId" || '|' || COALESCE("variantId", '-'));

ALTER TABLE "CustomerAddress"
  ADD CONSTRAINT "CustomerAddress_phone_e164" CHECK ("phone" ~ '^\+989[0-9]{9}$'),
  ADD CONSTRAINT "CustomerAddress_postalCode_digits" CHECK ("postalCode" ~ '^[0-9]{10}$'),
  ADD CONSTRAINT "CustomerAddress_province_shape" CHECK ("province" ~ '^[a-z]+(-[a-z]+)?$'),
  ADD CONSTRAINT "CustomerAddress_text_present" CHECK (length(btrim("recipientName")) >= 2 AND length(btrim("city")) >= 2 AND length(btrim("line")) >= 10);
