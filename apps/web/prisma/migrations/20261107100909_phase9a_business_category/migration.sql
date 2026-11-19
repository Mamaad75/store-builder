-- Phase 9A: business category (what the merchant sells) is separate from the visual theme (templateVersionId).
--  * Store.businessCategory: a label validated by the application's registry. The CHECK validates only the KEY FORMAT,
--    so adding a category needs no migration.
--  * Best-effort backfill from the current template key (coffee -> coffee-food, fashion -> fashion, anything else
--    -> general). It is only an inferred starting value; store owners can change it.
--  * No change to Template/TemplateVersion rows, page content, settings or products.

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "businessCategory" TEXT NOT NULL DEFAULT 'general';

UPDATE "Store" AS s
SET "businessCategory" = CASE t."key"
  WHEN 'coffee' THEN 'coffee-food'
  WHEN 'fashion' THEN 'fashion'
  ELSE 'general'
END
FROM "TemplateVersion" AS tv
JOIN "Template" AS t ON t."id" = tv."templateId"
WHERE tv."id" = s."templateVersionId";

ALTER TABLE "Store" ADD CONSTRAINT "Store_businessCategory_format" CHECK ("businessCategory" ~ '^[a-z][a-z0-9-]{0,39}$');
