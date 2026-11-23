-- Phase 3.4 (D34-1): orders and invoices. EXPAND-only: four new tables and three enums; nothing existing is altered or dropped.
-- Reversible: down.sql.

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderPaymentMethod" AS ENUM ('COD');

-- CreateEnum
CREATE TYPE "OrderActor" AS ENUM ('CUSTOMER', 'MERCHANT', 'SYSTEM');

-- CreateTable
CREATE TABLE "StoreCounter" (
    "storeId" TEXT NOT NULL,
    "lastOrderNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StoreCounter_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "customerId" TEXT,
    "requestKey" VARCHAR(64) NOT NULL,
    "accessTokenHash" CHAR(64) NOT NULL,
    "recipientName" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "province" VARCHAR(32) NOT NULL,
    "city" VARCHAR(40) NOT NULL,
    "addressLine" VARCHAR(250) NOT NULL,
    "postalCode" CHAR(10) NOT NULL,
    "shippingMethodId" TEXT,
    "shippingName" VARCHAR(60) NOT NULL,
    "shippingKind" "ShippingKind" NOT NULL,
    "shippingCost" BIGINT NOT NULL,
    "paymentMethod" "OrderPaymentMethod" NOT NULL,
    "codFee" BIGINT NOT NULL DEFAULT 0,
    "subtotal" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "name" VARCHAR(120) NOT NULL,
    "variantLabel" VARCHAR(300) NOT NULL DEFAULT '',
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" BIGINT NOT NULL,
    "weightGrams" INTEGER,
    "position" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "actor" "OrderActor" NOT NULL,
    "actorId" TEXT,
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_accessTokenHash_key" ON "Order"("accessTokenHash");

-- CreateIndex
CREATE INDEX "Order_storeId_createdAt_id_idx" ON "Order"("storeId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "Order_storeId_status_createdAt_idx" ON "Order"("storeId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Order_storeId_customerId_createdAt_idx" ON "Order"("storeId", "customerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_number_key" ON "Order"("storeId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_requestKey_key" ON "Order"("storeId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_id_key" ON "Order"("storeId", "id");

-- CreateIndex
CREATE INDEX "OrderItem_storeId_orderId_position_idx" ON "OrderItem"("storeId", "orderId", "position");

-- CreateIndex
CREATE INDEX "OrderEvent_storeId_orderId_createdAt_idx" ON "OrderEvent"("storeId", "orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "StoreCounter" ADD CONSTRAINT "StoreCounter_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- CHECK constraints (the application validates first; these are the last line of defence) ----------

ALTER TABLE "StoreCounter" ADD CONSTRAINT "StoreCounter_nonnegative" CHECK ("lastOrderNumber" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_number_positive" CHECK ("number" >= 1),
  ADD CONSTRAINT "Order_requestKey_shape" CHECK ("requestKey" ~ '^[A-Za-z0-9_-]{16,64}$'),
  ADD CONSTRAINT "Order_accessTokenHash_hex" CHECK ("accessTokenHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "Order_phone_e164" CHECK ("phone" ~ '^\+989[0-9]{9}$'),
  ADD CONSTRAINT "Order_postalCode_digits" CHECK ("postalCode" ~ '^[0-9]{10}$'),
  ADD CONSTRAINT "Order_province_shape" CHECK ("province" ~ '^[a-z]+(-[a-z]+)?$'),
  ADD CONSTRAINT "Order_money_range" CHECK (
    "shippingCost" >= 0 AND "codFee" >= 0 AND "subtotal" >= 0 AND "total" = "subtotal" + "shippingCost" + "codFee"),
  ADD CONSTRAINT "Order_cod_fee_only_cod" CHECK ("paymentMethod" = 'COD' OR "codFee" = 0),
  ADD CONSTRAINT "Order_itemCount_range" CHECK ("itemCount" BETWEEN 1 AND 50000);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_quantity_range" CHECK ("quantity" BETWEEN 1 AND 1000),
  ADD CONSTRAINT "OrderItem_unitPrice_range" CHECK ("unitPrice" BETWEEN 0 AND 1000000000),
  ADD CONSTRAINT "OrderItem_lineTotal_matches" CHECK ("lineTotal" = "unitPrice"::bigint * "quantity"),
  ADD CONSTRAINT "OrderItem_weight_range" CHECK ("weightGrams" IS NULL OR "weightGrams" BETWEEN 0 AND 1000000),
  ADD CONSTRAINT "OrderItem_position_range" CHECK ("position" BETWEEN 0 AND 49);

ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_changes_status" CHECK ("fromStatus" IS NULL OR "fromStatus" <> "toStatus");
