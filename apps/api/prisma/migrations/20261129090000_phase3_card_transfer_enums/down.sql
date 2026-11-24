-- Reverse of part 1. PostgreSQL cannot drop a value from an enum: 'CARD_TRANSFER' stays in "OrderPaymentMethod" (harmless, unused once
-- part 2 is reversed and no order uses it). Run after part 2's down.sql; then delete this migration's row from "_prisma_migrations".
BEGIN;
DROP TYPE IF EXISTS "ReceiptStatus";
COMMIT;
