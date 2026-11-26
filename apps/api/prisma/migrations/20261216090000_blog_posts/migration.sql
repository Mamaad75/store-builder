-- The store blog: plain-text articles, published with the store. EXPAND-only (one table, one enum). Reversible: down.sql.
CREATE TYPE "BlogPostStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "excerpt" VARCHAR(300) NOT NULL DEFAULT '',
    "body" VARCHAR(10000) NOT NULL,
    "status" "BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BlogPost_storeId_slug_key" ON "BlogPost"("storeId", "slug");
CREATE INDEX "BlogPost_storeId_status_publishedAt_idx" ON "BlogPost"("storeId", "status", "publishedAt");
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A published post always has the date it was first published.
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_published_has_date" CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL);
