import { describe, expect, it } from "vitest";
import { GALLERY_FULL_MESSAGE, MAX_GALLERY_EXTRAS, MAX_PRODUCT_IMAGES, nextGalleryPosition } from "./gallery.js";

describe("product gallery limits", () => {
  it("six images in all: the product's own image and five more", () => {
    expect([MAX_PRODUCT_IMAGES, MAX_GALLERY_EXTRAS]).toEqual([6, 5]);
    expect(GALLERY_FULL_MESSAGE).toMatch(/[؀-ۿ]/);
  });
  it("takes the lowest free position, reuses a gap, and is null when full", () => {
    expect(nextGalleryPosition([])).toBe(1);
    expect(nextGalleryPosition([1, 2])).toBe(3);
    expect(nextGalleryPosition([1, 3, 4])).toBe(2);
    expect(nextGalleryPosition([2, 3, 4, 5])).toBe(1);
    expect(nextGalleryPosition([1, 2, 3, 4, 5])).toBeNull();
  });
});
