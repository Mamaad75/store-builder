-- Reverse of migration.sql (phase 5.1). Run by hand only on rollback, after the backup step in docs/runbook.md. Discount codes and their
-- uses are lost; orders keep their totals but lose the discount columns, so orders WITH a discount must be handled first (the restored
-- CHECK refuses total <> subtotal + shipping + fee). Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "DiscountRedemption";
DROP TABLE IF EXISTS "Discount";
DROP TYPE IF EXISTS "DiscountScope";
DROP TYPE IF EXISTS "DiscountType";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_discount_code_shape", DROP CONSTRAINT IF EXISTS "Order_money_range";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "discountCode", DROP COLUMN IF EXISTS "discountAmount";
ALTER TABLE "Order" ADD CONSTRAINT "Order_money_range" CHECK (
  "shippingCost" >= 0 AND "codFee" >= 0 AND "subtotal" >= 0 AND "total" = "subtotal" + "shippingCost" + "codFee");
COMMIT;
