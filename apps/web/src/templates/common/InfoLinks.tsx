import { filledInfoPages } from "@store-builder/shared/modules/stores/info-pages";
import type { RenderContext } from "../types";

/** "Terms and information": links to the pages the store wrote, at the end of every page's content. Nothing when there are none. */
export default function InfoLinks({ ctx }: { ctx: Pick<RenderContext, "data" | "href"> }) {
  const pages = filledInfoPages(ctx.data.store.infoPages);
  if (pages.length === 0) return null;
  return (
    <nav aria-label="قوانین و اطلاعات" data-info-links="" style={{ maxWidth: 960, margin: "32px auto 16px", padding: "16px 16px 0", borderTop: "1px solid rgba(128,128,128,.35)" }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 20px", justifyContent: "center" }}>
        {pages.map((p) => (
          <li key={p.key}><a href={ctx.href(`/info/${p.key}`)} style={{ color: "inherit", textDecoration: "underline", display: "inline-block", padding: "8px 0", minHeight: 24 }}>{p.title}</a></li>
        ))}
      </ul>
    </nav>
  );
}
