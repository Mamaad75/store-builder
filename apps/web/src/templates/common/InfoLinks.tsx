import { filledInfoPages } from "@store-builder/shared/modules/stores/info-pages";
import type { RenderContext } from "../types";
import c from "./content.module.css";

/** "Terms and information": links to the pages the store wrote, at the end of every page's content. Nothing when there are none. */
export default function InfoLinks({ ctx }: { ctx: Pick<RenderContext, "data" | "href"> }) {
  const pages = filledInfoPages(ctx.data.store.infoPages);
  if (pages.length === 0) return null;
  return (
    <nav aria-label="قوانین و اطلاعات" data-info-links="" className={`${c.infoLinks} ${c.scope}`}>
      <ul>
        {pages.map((p) => (
          <li key={p.key}><a href={ctx.href(`/info/${p.key}`)}>{p.title}</a></li>
        ))}
      </ul>
    </nav>
  );
}
