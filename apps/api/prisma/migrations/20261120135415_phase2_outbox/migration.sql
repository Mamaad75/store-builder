-- Phase 2.2 (ADR 0002 §2.8): transactional outbox. EXPAND ONLY: one new, empty table; no existing table, column or row is touched,
-- so it takes no lock on existing data and runs in milliseconds. Reverse: down.sql in this folder.

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "storeId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(200),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_availableAt_idx" ON "OutboxEvent"("publishedAt", "availableAt");

-- Defensive CHECK constraints (not expressible in schema.prisma): "<context>.<event>" in lower case, and a non-negative retry count.
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_type_format" CHECK ("type" ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*)+$');
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_attempts_nonnegative" CHECK ("attempts" >= 0);
