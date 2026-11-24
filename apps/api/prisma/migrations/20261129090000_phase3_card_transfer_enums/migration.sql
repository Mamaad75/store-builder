-- D35b-1 (card-to-card), part 1 of 2: enum values only (a value added by ALTER TYPE cannot be used in the same transaction). EXPAND-only.
ALTER TYPE "OrderPaymentMethod" ADD VALUE IF NOT EXISTS 'CARD_TRANSFER';
CREATE TYPE "ReceiptStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');
