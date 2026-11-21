-- Reverse of migration.sql (phase 2.4). NOT applied by Prisma; run by hand only if the release is rolled back, after the backup step in
-- docs/runbook.md. Every stored store secret is lost with the table (owners must enter them again). Afterwards delete this migration's row
-- from "_prisma_migrations".
BEGIN;
DROP TABLE "StoreSecret";
COMMIT;
