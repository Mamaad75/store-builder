-- Smaller copies of uploaded images (responsive images). EXPAND-only: one column, false for every existing image (they are filled in by
-- the backfill script, apps/api/scripts/backfill-media-variants.ts). Reversible: down.sql.
ALTER TABLE "Media" ADD COLUMN "variantsReady" BOOLEAN NOT NULL DEFAULT false;
