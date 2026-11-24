-- D35b-1 (card-to-card), part 2 of 2: the store's bank cards and the shoppers' transfer receipts. EXPAND-only. Reversible: down.sql.

CREATE TABLE "StoreBankCard" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cardNumber" VARCHAR(16) NOT NULL,
    "holderName" VARCHAR(60) NOT NULL,
    "bankName" VARCHAR(40) NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoreBankCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransferReceipt" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'SUBMITTED',
    "trackingCode" VARCHAR(30) NOT NULL,
    "payerCardLast4" CHAR(4) NOT NULL,
    "image" BYTEA NOT NULL,
    "imageMime" VARCHAR(20) NOT NULL,
    "imageWidth" INTEGER NOT NULL,
    "imageHeight" INTEGER NOT NULL,
    "reviewNote" VARCHAR(300) NOT NULL DEFAULT '',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransferReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoreBankCard_storeId_position_idx" ON "StoreBankCard"("storeId", "position");
CREATE UNIQUE INDEX "StoreBankCard_storeId_cardNumber_key" ON "StoreBankCard"("storeId", "cardNumber");
CREATE INDEX "TransferReceipt_storeId_orderId_createdAt_idx" ON "TransferReceipt"("storeId", "orderId", "createdAt");
CREATE INDEX "TransferReceipt_storeId_status_createdAt_idx" ON "TransferReceipt"("storeId", "status", "createdAt");

ALTER TABLE "StoreBankCard" ADD CONSTRAINT "StoreBankCard_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransferReceipt" ADD CONSTRAINT "TransferReceipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransferReceipt" ADD CONSTRAINT "TransferReceipt_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- CHECK constraints ----------
ALTER TABLE "StoreBankCard"
  ADD CONSTRAINT "StoreBankCard_number_shape" CHECK ("cardNumber" ~ '^[0-9]{16}$'),
  ADD CONSTRAINT "StoreBankCard_holder_present" CHECK (length(btrim("holderName")) >= 2),
  ADD CONSTRAINT "StoreBankCard_position_range" CHECK ("position" BETWEEN 0 AND 4);

ALTER TABLE "TransferReceipt"
  ADD CONSTRAINT "TransferReceipt_tracking_shape" CHECK ("trackingCode" ~ '^[0-9A-Za-z]{4,30}$'),
  ADD CONSTRAINT "TransferReceipt_last4_shape" CHECK ("payerCardLast4" ~ '^[0-9]{4}$'),
  ADD CONSTRAINT "TransferReceipt_image_size" CHECK (octet_length("image") BETWEEN 1 AND 3145728),
  ADD CONSTRAINT "TransferReceipt_image_mime" CHECK ("imageMime" IN ('image/webp')),
  ADD CONSTRAINT "TransferReceipt_reviewed" CHECK (("status" = 'SUBMITTED') = ("reviewedAt" IS NULL)),
  ADD CONSTRAINT "TransferReceipt_reject_has_note" CHECK ("status" <> 'REJECTED' OR length(btrim("reviewNote")) >= 3);

-- One receipt under review and at most one approved receipt per order.
CREATE UNIQUE INDEX "TransferReceipt_one_pending_per_order" ON "TransferReceipt"("storeId", "orderId") WHERE "status" = 'SUBMITTED';
CREATE UNIQUE INDEX "TransferReceipt_one_approved_per_order" ON "TransferReceipt"("storeId", "orderId") WHERE "status" = 'APPROVED';

-- Unpaid orders are prepaid ones (online or card-to-card) with a deadline; cash-on-delivery orders never have one.
ALTER TABLE "Order" DROP CONSTRAINT "Order_awaiting_is_online", DROP CONSTRAINT "Order_deadline_online_only";
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_awaiting_is_prepaid" CHECK ("status" <> 'AWAITING_PAYMENT' OR "paymentMethod" IN ('ONLINE', 'CARD_TRANSFER')),
  ADD CONSTRAINT "Order_deadline_prepaid_only" CHECK (("paymentMethod" IN ('ONLINE', 'CARD_TRANSFER')) = ("paymentDeadline" IS NOT NULL));
