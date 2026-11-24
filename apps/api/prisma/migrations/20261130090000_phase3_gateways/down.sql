-- Reverse of migration.sql (D35c-1). Run by hand only on rollback, after the backup step in docs/runbook.md. Aghaye Pardakht attempts and
-- orders must be gone first (the restored CHECKs refuse them). Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_provider_known", DROP CONSTRAINT IF EXISTS "Payment_authority_shape", DROP CONSTRAINT IF EXISTS "Payment_amount_range";
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_provider_known" CHECK ("provider" IN ('ZARINPAL')),
  ADD CONSTRAINT "Payment_authority_shape" CHECK ("authority" ~ '^[AS][0-9A-Za-z]{35}$'),
  ADD CONSTRAINT "Payment_amount_range" CHECK ("amountRial" BETWEEN 1000 AND 1000000000);
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_gateway_online_only", DROP CONSTRAINT IF EXISTS "Order_gateway_known";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "paymentGateway";
COMMIT;
