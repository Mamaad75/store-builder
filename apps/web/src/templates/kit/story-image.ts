import { starterMediaKey } from "@store-builder/shared/lib/storage/keys";
import { isStarterAssetPath } from "@store-builder/shared/lib/storage/starter-assets";
import { sectionImage } from "@store-builder/shared/templates/engine/listing";
import type { SectionComponent } from "../types";

type StoryProps = Parameters<SectionComponent<"imageText">>[0];

export function storyImage({ ctx, section }: StoryProps) {
  const image = sectionImage(ctx, section.props.imageId);
  if (image || section.id !== "home-about" || ctx.page.type !== "HOME") return image;

  // Older stores can still have the default story section without a saved image.
  const path = "/theme-demos/" + ctx.data.template.key + "-product-3.webp";
  if (!isStarterAssetPath(path)) return null;
  const url = ctx.mediaUrl(starterMediaKey("demo", path));
  return url ? { url, width: 480, height: 480 } : null;
}
