-- Reverse of migration.sql (phase 3.3b). Run by hand only on rollback, after the backup step in docs/runbook.md; afterwards delete this
-- migration's row from "_prisma_migrations". Customer passwords are lost (SMS-code sign-in keeps working); the guest/phone link flag is lost.
BEGIN;
ALTER TABLE "Order" DROP COLUMN IF EXISTS "linkedByPhone";
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_passwordHash_argon2id";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "passwordHash";
COMMIT;
