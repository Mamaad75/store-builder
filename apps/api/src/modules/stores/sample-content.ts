import { randomBytes } from "node:crypto";
import { starterAssetForKey, starterMediaKey } from "@store-builder/shared/lib/storage/keys";
import { makeSearchKey } from "@store-builder/shared/lib/text";
import type { loadThemeDemo } from "@store-builder/shared/templates/demo";

type Demo = NonNullable<ReturnType<typeof loadThemeDemo>>;
type DemoImage = Demo["data"]["images"][string];

export function prepareSampleContent(demo: Demo, storeId: string, ownerId: string) {
  const { data } = demo;
  const mediaByKey = new Map<string, {
    id: string; key: string; uploadedById: string; mimeType: string; sizeBytes: number; width: number; height: number;
  }>();
  const registerImage = (image: DemoImage) => {
    const existing = mediaByKey.get(image.key);
    if (existing) return existing.id;

    const path = demo.mediaUrl(image.key);
    if (!path) throw new Error("Theme starter image has no path");
    const key = starterMediaKey(storeId, path);
    const asset = starterAssetForKey(key);
    if (!asset) throw new Error("Theme starter image is missing from the manifest");
    const id = randomBytes(16).toString("hex");
    mediaByKey.set(image.key, {
      id, key, uploadedById: ownerId, mimeType: "image/webp", sizeBytes: asset.sizeBytes, width: image.width, height: image.height,
    });
    return id;
  };

  const categoryIds = new Map<string, string>();
  const categories = data.categories.map(({ id: demoId, name, slug }, position) => {
    const id = randomBytes(16).toString("hex");
    categoryIds.set(demoId, id);
    return { id, name, slug, position };
  });
  const products = data.products.map(({ name, slug, description, price, stockQuantity, specs, categoryId, image }, position) => ({
    name, slug, description, price, stockQuantity, specs, position,
    status: "ACTIVE" as const,
    searchKey: makeSearchKey(name),
    categoryId: categoryId ? categoryIds.get(categoryId) : null,
    imageId: image ? registerImage(image) : null,
  }));
  const pages = data.pages.map((page) => ({
    ...page,
    sections: page.sections.map((section) => {
      const props = section.props;
      if (!("imageId" in props) || typeof props.imageId !== "string") return section;
      const image = data.images[props.imageId];
      return image ? { ...section, props: { ...props, imageId: registerImage(image) } } : section;
    }),
  }));

  return { categories, products, pages, media: [...mediaByKey.values()], description: data.store.description };
}
