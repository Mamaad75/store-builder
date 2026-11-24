-- Reverse of migration.sql (D35b-1 part 2). Run by hand only on rollback, after the backup step in docs/runbook.md. ALL RECEIPTS AND BANK
-- CARDS ARE LOST (export them first). Card-to-card orders must be gone first (cancel unpaid ones, or move them to another method by hand):
-- the restored CHECKs refuse them. Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TABLE IF EXISTS "TransferReceipt";
DROP TABLE IF EXISTS "StoreBankCard";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_awaiting_is_prepaid", DROP CONSTRAINT IF EXISTS "Order_deadline_prepaid_only";
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_awaiting_is_online" CHECK ("status" <> 'AWAITING_PAYMENT' OR "paymentMethod" = 'ONLINE'),
  ADD CONSTRAINT "Order_deadline_online_only" CHECK (("paymentMethod" = 'ONLINE') = ("paymentDeadline" IS NOT NULL));
COMMIT;
