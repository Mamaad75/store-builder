-- Phase 2.4 (D24-1): encrypted store secrets. EXPAND ONLY: one new, empty table; nothing existing changes. Reverse: down.sql.

-- CreateTable
CREATE TABLE "StoreSecret" (
    "storeId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "keyId" VARCHAR(32) NOT NULL,
    "wrappedKey" BYTEA NOT NULL,
    "sealed" BYTEA NOT NULL,
    "hint" VARCHAR(4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSecret_pkey" PRIMARY KEY ("storeId","name")
);

-- CreateIndex
CREATE INDEX "StoreSecret_keyId_idx" ON "StoreSecret"("keyId");

-- AddForeignKey
ALTER TABLE "StoreSecret" ADD CONSTRAINT "StoreSecret_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defensive CHECK constraints: the name format, and envelope sizes (12-byte IV + 32-byte key + 16-byte tag; sealed >= IV + tag).
ALTER TABLE "StoreSecret" ADD CONSTRAINT "StoreSecret_name_format" CHECK ("name" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');
ALTER TABLE "StoreSecret" ADD CONSTRAINT "StoreSecret_envelope_sizes" CHECK (octet_length("wrappedKey") = 60 AND octet_length("sealed") >= 28);
