-- Reverse of migration.sql (finance). Run by hand only on rollback, after the backup step in docs/runbook.md: plans, purchases, wallets, ledgers,
-- referral codes and referrals are all lost (credit included). Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "Referral";
DROP TABLE IF EXISTS "StoreReferralCode";
DROP TABLE IF EXISTS "WalletEntry";
DROP TABLE IF EXISTS "StoreWallet";
DROP TABLE IF EXISTS "SubscriptionPurchase";
DROP TABLE IF EXISTS "StoreSubscription";
DROP TABLE IF EXISTS "Plan";
DROP TYPE IF EXISTS "ReferralStatus";
DROP TYPE IF EXISTS "WalletEntryKind";
COMMIT;
