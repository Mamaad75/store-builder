-- Reverse of migration.sql (product reviews). Run by hand only on rollback, after the backup step in docs/runbook.md: every review is lost.
-- Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "ProductReview";
DROP TYPE IF EXISTS "ReviewStatus";
COMMIT;
