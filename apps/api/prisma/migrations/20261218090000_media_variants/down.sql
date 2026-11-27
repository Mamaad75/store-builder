-- Reverse of migration.sql (media variants). Run by hand only on rollback, after the backup step in docs/runbook.md. The copies already in
-- storage stay there until the media cleanup finds them without a main object... they are named after their main object, so deleting
-- the main object (or the media row) later still removes them. Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
ALTER TABLE "Media" DROP COLUMN IF EXISTS "variantsReady";
COMMIT;
