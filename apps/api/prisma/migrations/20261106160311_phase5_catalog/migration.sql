-- Phase 5: product & category management.
--  * ProductStatus gains ARCHIVED (the new value is not used in this migration, as PostgreSQL requires)
--  * stockQuantity replaces inStock (converted: true -> 1, false -> 0)
--  * searchKey (application-computed, normalised)
--  * DB-level CHECK constraints that mirror the application's Persian normalisation and limits

-- AlterEnum
ALTER TYPE "ProductStatus" ADD VALUE 'ARCHIVED';

-- AlterTable: add new columns first so existing data can be converted before inStock is dropped
ALTER TABLE "Product"
  ADD COLUMN "searchKey" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "stockQuantity" INTEGER NOT NULL DEFAULT 0;

UPDATE "Product" SET "stockQuantity" = CASE WHEN "inStock" THEN 1 ELSE 0 END;
ALTER TABLE "Product" DROP COLUMN "inStock";

-- Best-effort normalisation of any pre-existing rows so the CHECK constraints below can be added
-- (no application code created products before this migration).
UPDATE "Product" SET
  "name" = translate("name", 'يكى', 'یکی'),
  "slug" = lower(translate("slug", 'يكى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'یکی01234567890123456789')),
  "searchKey" = lower(translate("name", 'يكى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'یکی01234567890123456789'));
UPDATE "ProductCategory" SET
  "name" = translate("name", 'يكى', 'یکی'),
  "slug" = lower(translate("slug", 'يكى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'یکی01234567890123456789'));

-- CreateIndex: stable ordering for the paginated product list
CREATE INDEX "Product_storeId_createdAt_id_idx" ON "Product"("storeId", "createdAt" DESC, "id");

-- Defensive CHECK constraints (Prisma cannot express these).
-- Numeric ranges
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_range" CHECK ("stockQuantity" BETWEEN 0 AND 1000000);
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_max" CHECK ("price" <= 1000000000);
ALTER TABLE "Product" ADD CONSTRAINT "Product_description_length" CHECK (char_length("description") <= 5000);

-- Slugs: 1..80 chars, no whitespace or URL-reserved characters, no leading/trailing hyphen,
-- never the Arabic yeh/kaf variants (the application normalises them to the Persian letters)
ALTER TABLE "Product" ADD CONSTRAINT "Product_slug_format" CHECK (
  char_length("slug") BETWEEN 1 AND 80
  AND "slug" !~ '[[:space:]/?#%\\]'
  AND "slug" !~ '^-|-$'
  AND "slug" !~ '[يك]'
);
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_slug_format" CHECK (
  char_length("slug") BETWEEN 1 AND 80
  AND "slug" !~ '[[:space:]/?#%\\]'
  AND "slug" !~ '^-|-$'
  AND "slug" !~ '[يك]'
);

-- Names: non-empty, bounded, Persian-normalised
ALTER TABLE "Product" ADD CONSTRAINT "Product_name_normalized" CHECK (
  char_length(btrim("name")) BETWEEN 1 AND 120 AND "name" !~ '[يكى]'
);
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_name_normalized" CHECK (
  char_length(btrim("name")) BETWEEN 1 AND 60 AND "name" !~ '[يكى]'
);

-- searchKey is lowercase and contains no Arabic yeh/kaf or Persian/Arabic-Indic digits
ALTER TABLE "Product" ADD CONSTRAINT "Product_searchkey_normalized" CHECK (
  "searchKey" = lower("searchKey") AND "searchKey" !~ '[يكى٠-٩۰-۹]'
);
