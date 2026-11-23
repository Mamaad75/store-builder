-- Reverse of migration.sql (phase 3.2b). NOT applied by Prisma; run by hand only if the release is rolled back, after the backup step in
-- docs/runbook.md. Price links, live prices, rate history and the "rates" settings and key are lost; product prices keep their last
-- computed values. Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DELETE FROM "PlatformSetting" WHERE "key" = 'rates';
DELETE FROM "PlatformSecret" WHERE "name" LIKE 'rates.%';
ALTER TABLE "PlatformSetting" DROP CONSTRAINT "PlatformSetting_key_known";
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_key_known" CHECK ("key" IN ('sms', 'payment', 'ai'));
DROP TABLE IF EXISTS "LivePrice";
DROP TABLE IF EXISTS "PriceLink";
DROP TABLE IF EXISTS "ExchangeRate";
DROP TYPE IF EXISTS "PriceLinkStatus";
DROP TYPE IF EXISTS "PriceLinkKind";
DROP TYPE IF EXISTS "RateStatus";
DROP TYPE IF EXISTS "RateCode";
COMMIT;
