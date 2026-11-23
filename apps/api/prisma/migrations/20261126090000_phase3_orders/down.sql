-- Reverse of migration.sql (phase 3.4). NOT applied by Prisma; run by hand only if the release is rolled back, after the backup step in
-- docs/runbook.md. ALL ORDERS ARE LOST (export them first). Stock already taken by placed orders stays taken. Afterwards delete this
-- migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "OrderEvent";
DROP TABLE IF EXISTS "OrderItem";
DROP TABLE IF EXISTS "Order";
DROP TABLE IF EXISTS "StoreCounter";
DROP TYPE IF EXISTS "OrderActor";
DROP TYPE IF EXISTS "OrderPaymentMethod";
DROP TYPE IF EXISTS "OrderStatus";
COMMIT;
