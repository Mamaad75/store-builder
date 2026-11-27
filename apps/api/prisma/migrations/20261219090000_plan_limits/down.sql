-- Reverse of migration.sql (plan limits). Run by hand only on rollback; the limits chosen for each plan are lost.
-- Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
ALTER TABLE "Plan" DROP CONSTRAINT IF EXISTS "Plan_maxStaff_check";
ALTER TABLE "Plan" DROP CONSTRAINT IF EXISTS "Plan_maxProducts_check";
ALTER TABLE "Plan" DROP COLUMN IF EXISTS "maxStaff";
ALTER TABLE "Plan" DROP COLUMN IF EXISTS "maxProducts";
COMMIT;
