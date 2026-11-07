-- Phase 8: page editing.
--  * Page.revision: per-page optimistic-concurrency token (explicit conflicts instead of silent overwrites)
--  * Page.legacySections: where the explicit recovery action moves invalid/unknown section entries (never deleted)
--  * the core pages cannot be hidden (mirrors the application rule)

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "legacySections" JSONB,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Page" ADD CONSTRAINT "Page_core_pages_visible" CHECK ("isVisible" OR "type" NOT IN ('HOME', 'PRODUCTS'));
ALTER TABLE "Page" ADD CONSTRAINT "Page_revision_positive" CHECK ("revision" >= 1);
