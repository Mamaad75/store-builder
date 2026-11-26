-- Reverse of migration.sql (product gallery). Run by hand only on rollback, after the backup step in docs/runbook.md. The extra images stop
-- being shown (the first image of every product is unaffected); their files stay in storage until the media cleanup finds them
-- unreferenced. Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "ProductImage";
COMMIT;
