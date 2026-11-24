-- Reverse of migration.sql (ADR 0003 G2). Run by hand only on rollback, after the backup step in docs/runbook.md. The suspension history is
-- lost and every suspended store becomes reachable again: lift or record open suspensions first. Afterwards delete this migration's row
-- from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "StoreSuspension";
ALTER TABLE "Store" DROP COLUMN IF EXISTS "suspendedAt";
DROP TYPE IF EXISTS "SuspensionReason";
COMMIT;
