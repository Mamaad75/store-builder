-- Reverse of migration.sql (phase 2.2 outbox). NOT applied by Prisma; run by hand only if the release is rolled back, after the
-- backup step in docs/runbook.md. Unpublished events are lost with the table, so first check that the relay drained it:
--   SELECT count(*) FROM "OutboxEvent" WHERE "publishedAt" IS NULL;   -- should be 0 (stop the worker before running this)
-- Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE "OutboxEvent";
COMMIT;
