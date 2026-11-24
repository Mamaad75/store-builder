-- Phase 3.5 (D35-1), part 1 of 2: new enum values for online payment. Kept apart from part 2 because PostgreSQL cannot use an enum value
-- in the transaction that adds it (part 2's CHECKs use them). EXPAND-only.
ALTER TYPE "OrderPaymentMethod" ADD VALUE 'ONLINE';
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_PAYMENT';
ALTER TYPE "OrderStatus" ADD VALUE 'EXPIRED';
