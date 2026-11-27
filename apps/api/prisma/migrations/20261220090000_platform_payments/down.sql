-- Reverse of migration.sql (platform payments). Run by hand only on rollback, after the backup step in docs/runbook.md: every recorded gateway payment of
-- the platform is lost, and wallet ledger lines of kind TOPUP or REFUND must be deleted first (PostgreSQL cannot drop enum values: the type is rebuilt).
-- Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "PlatformPayment";
DROP TYPE IF EXISTS "PlatformPaymentStatus";
DROP TYPE IF EXISTS "PlatformPaymentPurpose";
DROP INDEX IF EXISTS "SubscriptionPurchase_paymentId_key";
ALTER TABLE "SubscriptionPurchase" DROP COLUMN IF EXISTS "paymentId";
DELETE FROM "WalletEntry" WHERE "kind" IN ('TOPUP', 'REFUND');
ALTER TYPE "WalletEntryKind" RENAME TO "WalletEntryKind_old";
CREATE TYPE "WalletEntryKind" AS ENUM ('REFERRAL_REWARD', 'PURCHASE', 'ADMIN_ADJUST');
ALTER TABLE "WalletEntry" ALTER COLUMN "kind" TYPE "WalletEntryKind" USING ("kind"::text::"WalletEntryKind");
DROP TYPE "WalletEntryKind_old";
COMMIT;
