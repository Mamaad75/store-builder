-- Reverse of migration.sql (phase 3.5 part 2). Run by hand only on rollback, after the backup step in docs/runbook.md. ALL PAYMENT RECORDS
-- ARE LOST (export them first: they are the evidence of what was paid). Online orders keep their status; turn AWAITING_PAYMENT ones into
-- CANCELLED first if part 1 is reversed too. Afterwards delete this migration's row from "_prisma_migrations".
-- Re-applying migration.sql afterwards is safe: it gives online orders a deadline back before adding its CHECKs (drilled 2026-11-24).
BEGIN;
DROP TABLE IF EXISTS "Payment";
DROP TYPE IF EXISTS "PaymentStatus";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_awaiting_is_online";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_deadline_online_only";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "paymentDeadline";
COMMIT;
