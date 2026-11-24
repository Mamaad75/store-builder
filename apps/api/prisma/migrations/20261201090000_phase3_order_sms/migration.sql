-- Phase 3.6 (D36-1): order SMS: the stores' choice and the log of sent/skipped messages (idempotency + monthly cap). EXPAND-only. Reversible: down.sql.

CREATE TABLE "StoreSmsSetting" (
    "storeId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "merchantPhone" VARCHAR(13),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreSmsSetting_pkey" PRIMARY KEY ("storeId")
);
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "eventId" VARCHAR(40) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "orderId" TEXT,
    "recipientHash" VARCHAR(64),
    "status" VARCHAR(10) NOT NULL,
    "reason" VARCHAR(30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SmsMessage_storeId_createdAt_idx" ON "SmsMessage"("storeId", "createdAt");
CREATE INDEX "SmsMessage_recipientHash_createdAt_idx" ON "SmsMessage"("recipientHash", "createdAt");
CREATE UNIQUE INDEX "SmsMessage_eventId_kind_key" ON "SmsMessage"("eventId", "kind");
ALTER TABLE "StoreSmsSetting" ADD CONSTRAINT "StoreSmsSetting_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- CHECK constraints ----------
ALTER TABLE "StoreSmsSetting" ADD CONSTRAINT "StoreSmsSetting_phone_e164" CHECK ("merchantPhone" IS NULL OR "merchantPhone" ~ '^\+989[0-9]{9}$');
ALTER TABLE "SmsMessage"
  ADD CONSTRAINT "SmsMessage_status_known" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  ADD CONSTRAINT "SmsMessage_kind_known" CHECK ("kind" IN ('SHOPPER_PLACED', 'SHOPPER_SHIPPED', 'SHOPPER_CANCELLED', 'SHOPPER_EXPIRED', 'SHOPPER_RECEIPT_REJECTED', 'MERCHANT_NEW_ORDER', 'MERCHANT_RECEIPT')),
  ADD CONSTRAINT "SmsMessage_reason_shape" CHECK ("reason" IS NULL OR "reason" ~ '^[a-z_]{1,30}$'),
  ADD CONSTRAINT "SmsMessage_recipient_hex" CHECK ("recipientHash" IS NULL OR "recipientHash" ~ '^[0-9a-f]{64}$');
