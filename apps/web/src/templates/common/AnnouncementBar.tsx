import { announcementPath } from "@store-builder/shared/modules/stores/info-pages";
import { readableTextOn } from "@store-builder/shared/templates/engine/color";
import type { RenderContext } from "../types";

/** The one-line announcement above the whole page, in the store's brand colour (text colour chosen for contrast). The link only ever points at the store's own pages. */
export default function AnnouncementBar({ ctx }: { ctx: Pick<RenderContext, "data" | "href"> }) {
  const a = ctx.data.store.announcement;
  if (!a) return null;
  const path = announcementPath(a.link);
  const bg = ctx.data.store.primaryColor;
  const fg = readableTextOn(bg);
  return (
    <div role="region" aria-label="اعلان فروشگاه" data-announcement="" dir={ctx.data.store.direction} style={{ background: bg, color: fg, textAlign: "center", padding: "8px 16px", fontSize: 14, lineHeight: 1.6, fontFamily: "inherit" }}>
      {path ? <a href={ctx.href(path)} style={{ color: "inherit", textDecoration: "underline", display: "inline-block", minHeight: 24 }}>{a.text}</a> : a.text}
    </div>
  );
}
