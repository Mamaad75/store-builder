import { parsePostBody, type PostBlock } from "@store-builder/shared/modules/blog/blog";
import type { RenderContext } from "../types";
import c from "./content.module.css";

/** Questions and answers: each heading opens its paragraphs (a native disclosure, no script); text before the first heading is an introduction. */
function Faq({ blocks }: { blocks: PostBlock[] }) {
  const intro: string[] = [];
  const items: { q: string; a: string[] }[] = [];
  for (const b of blocks) {
    if (b.type === "h") items.push({ q: b.text, a: [] });
    else if (items.length === 0) intro.push(b.text);
    else items[items.length - 1]!.a.push(b.text);
  }
  return (
    <>
      {intro.map((t, i) => <p key={i} className={c.p}>{t}</p>)}
      <div className={c.stack} style={{ gap: 8 }}>
        {items.map((it, i) => (
          <details key={i} className={c.disclosure}>
            <summary>{it.q}</summary>
            {it.a.map((t, j) => <p key={j}>{t}</p>)}
          </details>
        ))}
      </div>
    </>
  );
}

/** One information page (terms, shipping, returns, privacy, FAQ) inside the store's own theme layout, drawn with the theme's tokens. Text only: nothing typed is ever markup. */
export default function InfoView({ ctx }: { ctx: RenderContext }) {
  const info = ctx.info;
  if (!info) return null;
  const blocks = parsePostBody(info.body);
  return (
    <article className={`${c.wrap} ${c.scope}`} data-info={info.key}>
      <nav aria-label="مسیر"><a href={ctx.href("/")} className={c.back}>← صفحهٔ اصلی</a></nav>
      <h1 className={c.title}>{info.title}</h1>
      {info.key === "faq" ? <Faq blocks={blocks} /> : blocks.map((b, i) => (b.type === "h" ? <h2 key={i} className={c.h2}>{b.text}</h2> : <p key={i} className={c.p}>{b.text}</p>))}
    </article>
  );
}
