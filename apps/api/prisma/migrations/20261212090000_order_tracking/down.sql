-- Reverse of migration.sql (order tracking code). Run by hand only on rollback, after the backup step in docs/runbook.md. The entered tracking
-- codes are lost (shippers keep the originals). Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_trackingCode_shipped";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_trackingCode_shape";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "trackingCode";
COMMIT;
