-- The extra images of a product's gallery (images 2 to 6). EXPAND-only (one new table). Reversible: down.sql.
-- The first image is still Product."imageId", so every existing reader (cards, published snapshots) is unchanged.
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductImage_productId_position_key" ON "ProductImage"("productId", "position");
CREATE UNIQUE INDEX "ProductImage_productId_mediaId_key" ON "ProductImage"("productId", "mediaId");
CREATE INDEX "ProductImage_storeId_mediaId_idx" ON "ProductImage"("storeId", "mediaId");
-- A row stays inside its own store (composite keys). Deleting a product removes its rows; a media row still used here cannot be deleted.
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_storeId_mediaId_fkey" FOREIGN KEY ("storeId", "mediaId") REFERENCES "Media"("storeId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
-- Five extra images at most (six with the first): positions 1 to 5.
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_position_range" CHECK ("position" BETWEEN 1 AND 5);
