-- Phase 7: media and images.
--  * Media.status (PENDING -> READY -> DELETING) drives the upload/cleanup consistency strategy
--  * Store.logoId: nullable logo, composite FK (id, logoId) -> Media(storeId, id) so a logo can only be an image of the SAME store
--  * Product.image / Store.logo use NO ACTION (checked at statement end) instead of RESTRICT, so deleting a whole store
--    (which cascades to its products AND its media in one statement) is not blocked by their own references;
--    deleting a single referenced Media row is still rejected
--  * CHECK constraints mirror the server-side upload pipeline (object key shape bound to the store, output type, limits)

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'READY', 'DELETING');

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_storeId_imageId_fkey";

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "status" "MediaStatus" NOT NULL DEFAULT 'READY';

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "logoId" TEXT;

-- CreateIndex
CREATE INDEX "Media_status_createdAt_idx" ON "Media"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_id_logoId_fkey" FOREIGN KEY ("id", "logoId") REFERENCES "Media"("storeId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_imageId_fkey" FOREIGN KEY ("storeId", "imageId") REFERENCES "Media"("storeId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Defensive CHECK constraints (the application enforces the same rules; these stop a bypass).
-- The object key is server-generated: stores/<storeId>/<32 hex chars>.<ext>; it must live under the owning store's prefix.
ALTER TABLE "Media" ADD CONSTRAINT "Media_key_format" CHECK (
  "key" ~ '^stores/[A-Za-z0-9]{1,64}/[0-9a-f]{32}\.webp$'
  AND "key" LIKE 'stores/' || "storeId" || '/%'
);
-- The pipeline always re-encodes to WebP, so the stored type, the key extension and the metadata must agree.
ALTER TABLE "Media" ADD CONSTRAINT "Media_mime_allowed" CHECK ("mimeType" = 'image/webp');
ALTER TABLE "Media" ADD CONSTRAINT "Media_size_max" CHECK ("sizeBytes" <= 5242880);
ALTER TABLE "Media" ADD CONSTRAINT "Media_dimensions_range" CHECK (
  ("width" IS NULL OR "width" BETWEEN 1 AND 2048) AND ("height" IS NULL OR "height" BETWEEN 1 AND 2048)
);
