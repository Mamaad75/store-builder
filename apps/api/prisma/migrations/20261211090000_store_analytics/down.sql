-- Reverse of migration.sql (store trend charts). Run by hand only on rollback, after the backup step in docs/runbook.md. The recorded
-- page views and visitor counters are lost; orders and customers (the other chart series) are untouched. Afterwards delete this
-- migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "StoreDailyVisitor";
DROP TABLE IF EXISTS "StoreDailyStat";
COMMIT;
