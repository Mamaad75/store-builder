import { parsePostBody, type PostBlock } from "@store-builder/shared/modules/blog/blog";
import type { RenderContext } from "../types";

const wrap = { maxWidth: 760, margin: "32px auto", padding: "0 16px" } as const;
const edge = "1px solid rgba(128,128,128,.45)";

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
      {intro.map((t, i) => <p key={i} style={{ margin: "0 0 16px", lineHeight: 1.9 }}>{t}</p>)}
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((it, i) => (
          <details key={i} style={{ border: edge, borderRadius: 10, padding: "4px 14px" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, padding: "10px 0", minHeight: 24 }}>{it.q}</summary>
            {it.a.map((t, j) => <p key={j} style={{ margin: "0 0 12px", lineHeight: 1.9, overflowWrap: "anywhere" }}>{t}</p>)}
          </details>
        ))}
      </div>
    </>
  );
}

/** One information page (terms, shipping, returns, privacy, FAQ) inside the store's own theme layout. Text only: nothing typed is ever markup. */
export default function InfoView({ ctx }: { ctx: RenderContext }) {
  const info = ctx.info;
  if (!info) return null;
  const blocks = parsePostBody(info.body);
  return (
    <article style={wrap} data-info={info.key}>
      <nav aria-label="مسیر"><a href={ctx.href("/")} style={{ color: "inherit", textDecoration: "underline" }}>← صفحهٔ اصلی</a></nav>
      <h1 style={{ margin: "16px 0 24px" }}>{info.title}</h1>
      {info.key === "faq" ? <Faq blocks={blocks} /> : blocks.map((b, i) => (b.type === "h" ? <h2 key={i} style={{ margin: "24px 0 8px" }}>{b.text}</h2> : <p key={i} style={{ margin: "0 0 16px", lineHeight: 1.9, overflowWrap: "anywhere" }}>{b.text}</p>))}
    </article>
  );
}
