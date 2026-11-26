-- Store trend charts (dashboard home): page views and visitors per Tehran calendar day. EXPAND-only (two new tables). Reversible: down.sql.
-- Privacy: counters only. The visitor table holds a one-way daily hash (never an address or a cookie) and is purged after two days.

CREATE TABLE "StoreDailyStat" (
    "storeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StoreDailyStat_pkey" PRIMARY KEY ("storeId","day")
);
ALTER TABLE "StoreDailyStat" ADD CONSTRAINT "StoreDailyStat_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreDailyStat" ADD CONSTRAINT "StoreDailyStat_counts" CHECK ("views" >= 0 AND "visitors" >= 0 AND "visitors" <= "views");

CREATE TABLE "StoreDailyVisitor" (
    "storeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "hash" CHAR(64) NOT NULL,
    CONSTRAINT "StoreDailyVisitor_pkey" PRIMARY KEY ("storeId","day","hash")
);
CREATE INDEX "StoreDailyVisitor_day_idx" ON "StoreDailyVisitor"("day");
ALTER TABLE "StoreDailyVisitor" ADD CONSTRAINT "StoreDailyVisitor_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreDailyVisitor" ADD CONSTRAINT "StoreDailyVisitor_hash_shape" CHECK ("hash" ~ '^[0-9a-f]{64}$');
