-- Reverse of migration.sql (phase 3.2). NOT applied by Prisma; run by hand only if the release is rolled back, after the backup step in
-- docs/runbook.md. Every variant and every reservation is lost; products keep the price and stock they had (the lowest variant price and
-- the summed stock). Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE "StockReservation";
DROP TABLE "ProductVariant";
DROP TYPE "ReservationStatus";
DROP INDEX "Product_storeId_id_key";
COMMIT;
