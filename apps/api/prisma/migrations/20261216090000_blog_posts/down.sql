-- Reverse of migration.sql (blog posts). Run by hand only on rollback, after the backup step in docs/runbook.md: every post is lost (published
-- snapshots keep their copy). Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "BlogPost";
DROP TYPE IF EXISTS "BlogPostStatus";
COMMIT;
