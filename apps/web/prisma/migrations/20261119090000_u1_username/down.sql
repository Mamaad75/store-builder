-- Reverse of migration.sql (U1). NOT applied by Prisma; run by hand on a database restored from the pre-migration backup plan
-- (docs/runbook.md) only if the release is rolled back. Afterwards delete this migration's row from "_prisma_migrations".
-- Precondition: every user must have an e-mail again, otherwise SET NOT NULL fails (accounts created after U1 have none):
--   SELECT count(*) FROM "User" WHERE "email" IS NULL;   -- must be 0, or those accounts must be given an e-mail / removed first
BEGIN;
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "User" DROP CONSTRAINT "User_username_format";
DROP INDEX "User_username_key";
ALTER TABLE "User" DROP COLUMN "username";
COMMIT;
