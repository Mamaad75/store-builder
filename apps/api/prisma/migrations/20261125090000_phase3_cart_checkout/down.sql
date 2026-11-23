-- Reverse of migration.sql (phase 3.3). NOT applied by Prisma; run by hand only if the release is rolled back, after the backup step in
-- docs/runbook.md. Carts, shipping methods, saved addresses and product weights are lost. Afterwards delete this migration's row from
-- "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "CartItem";
DROP TABLE IF EXISTS "Cart";
DROP TABLE IF EXISTS "CustomerAddress";
DROP TABLE IF EXISTS "ShippingMethod";
DROP TYPE IF EXISTS "ShippingKind";
DROP INDEX IF EXISTS "Customer_storeId_id_key";
DROP INDEX IF EXISTS "ProductVariant_storeId_productId_id_key";
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_weightGrams_range";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "weightGrams";
COMMIT;
