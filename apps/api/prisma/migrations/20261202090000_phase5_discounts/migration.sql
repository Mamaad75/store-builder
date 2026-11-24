-- Phase 5.1 (D51-1): discount codes, their uses, and the discount on the order snapshot. EXPAND-only. Reversible: down.sql.

CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED', 'FREE_SHIPPING');
CREATE TYPE "DiscountScope" AS ENUM ('ALL', 'PRODUCTS', 'CATEGORIES');
ALTER TABLE "Order" ADD COLUMN     "discountAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "discountCode" VARCHAR(32);
CREATE TABLE "Discount" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "title" VARCHAR(80) NOT NULL DEFAULT '',
    "type" "DiscountType" NOT NULL,
    "value" BIGINT NOT NULL,
    "maxDiscount" BIGINT,
    "minOrder" BIGINT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "perCustomerLimit" INTEGER,
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "scope" "DiscountScope" NOT NULL DEFAULT 'ALL',
    "scopeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DiscountRedemption" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "phone" VARCHAR(13) NOT NULL,
    "customerId" TEXT,
    "amount" BIGINT NOT NULL,
    "released" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscountRedemption_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Discount_storeId_createdAt_idx" ON "Discount"("storeId", "createdAt");
CREATE UNIQUE INDEX "Discount_storeId_code_key" ON "Discount"("storeId", "code");
CREATE UNIQUE INDEX "Discount_storeId_id_key" ON "Discount"("storeId", "id");
CREATE INDEX "DiscountRedemption_discountId_released_idx" ON "DiscountRedemption"("discountId", "released");
CREATE INDEX "DiscountRedemption_storeId_phone_idx" ON "DiscountRedemption"("storeId", "phone");
CREATE UNIQUE INDEX "DiscountRedemption_storeId_orderId_key" ON "DiscountRedemption"("storeId", "orderId");
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_storeId_discountId_fkey" FOREIGN KEY ("storeId", "discountId") REFERENCES "Discount"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- CHECK constraints ----------
ALTER TABLE "Discount"
  ADD CONSTRAINT "Discount_code_shape" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  ADD CONSTRAINT "Discount_value_range" CHECK (
    ("type" = 'PERCENT' AND "value" BETWEEN 1 AND 100)
    OR ("type" = 'FIXED' AND "value" BETWEEN 1000 AND 1000000000)
    OR ("type" = 'FREE_SHIPPING' AND "value" = 0)
  ),
  ADD CONSTRAINT "Discount_max_percent_only" CHECK ("maxDiscount" IS NULL OR ("type" = 'PERCENT' AND "maxDiscount" BETWEEN 0 AND 1000000000)),
  ADD CONSTRAINT "Discount_min_order_range" CHECK ("minOrder" IS NULL OR "minOrder" BETWEEN 0 AND 1000000000),
  ADD CONSTRAINT "Discount_dates_order" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"),
  ADD CONSTRAINT "Discount_limits_positive" CHECK (("usageLimit" IS NULL OR "usageLimit" >= 1) AND ("perCustomerLimit" IS NULL OR "perCustomerLimit" >= 1)),
  ADD CONSTRAINT "Discount_scope_ids" CHECK (("scope" = 'ALL') = (cardinality("scopeIds") = 0) AND cardinality("scopeIds") <= 200);

ALTER TABLE "DiscountRedemption"
  ADD CONSTRAINT "DiscountRedemption_phone_e164" CHECK ("phone" ~ '^\+989[0-9]{9}$'),
  ADD CONSTRAINT "DiscountRedemption_amount_range" CHECK ("amount" BETWEEN 0 AND 2000000000);

-- The order total now subtracts the discount (never below zero; at most the items plus shipping).
ALTER TABLE "Order" DROP CONSTRAINT "Order_money_range";
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_money_range" CHECK (
    "shippingCost" >= 0 AND "codFee" >= 0 AND "subtotal" >= 0 AND "discountAmount" >= 0
    AND "discountAmount" <= "subtotal" + "shippingCost"
    AND "total" = "subtotal" + "shippingCost" + "codFee" - "discountAmount"),
  -- A discount needs its code; a code is shaped like one.
  ADD CONSTRAINT "Order_discount_code_shape" CHECK (("discountCode" IS NOT NULL OR "discountAmount" = 0) AND ("discountCode" IS NULL OR "discountCode" ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'));
