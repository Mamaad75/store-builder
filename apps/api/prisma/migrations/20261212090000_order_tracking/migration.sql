-- The carrier's tracking code of an order, entered by the merchant when the order is shipped. EXPAND-only (one nullable column). Reversible: down.sql.
ALTER TABLE "Order" ADD COLUMN "trackingCode" VARCHAR(40);
-- Letters, digits and . _ - only (no spaces or markup), 3 to 40 characters; and only an order that was shipped can have one.
ALTER TABLE "Order" ADD CONSTRAINT "Order_trackingCode_shape" CHECK ("trackingCode" IS NULL OR "trackingCode" ~ '^[A-Za-z0-9._-]{3,40}$');
ALTER TABLE "Order" ADD CONSTRAINT "Order_trackingCode_shipped" CHECK ("trackingCode" IS NULL OR "status" IN ('SHIPPED', 'DELIVERED'));
