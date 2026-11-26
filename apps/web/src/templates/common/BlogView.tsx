import { parsePostBody } from "@store-builder/shared/modules/blog/blog";
import type { RenderContext } from "../types";

const edge = "1px solid rgba(128,128,128,.45)";
const wrap = { maxWidth: 760, margin: "32px auto", padding: "0 16px" } as const;
const faDate = (iso: string) => new Date(iso).toLocaleDateString("fa-IR", { dateStyle: "long" });

/**
 * The store blog inside whatever theme the store uses: the theme's own Layout (header, footer, colours, fonts) wraps this plain,
 * accessible article markup. Post text is rendered as text blocks (headings and paragraphs), never as HTML.
 */
export default function BlogView({ ctx }: { ctx: RenderContext }) {
  const blog = ctx.blog;
  if (!blog) return null;
  if (blog.view === "post") {
    const { post } = blog;
    return (
      <article style={wrap} data-blog="post">
        <nav aria-label="مسیر"><a href={ctx.href("/blog")} style={{ color: "inherit", textDecoration: "underline" }}>← همهٔ مقاله‌ها</a></nav>
        <h1 style={{ margin: "16px 0 4px" }}>{post.title}</h1>
        <p style={{ margin: "0 0 24px" }}><time dateTime={post.publishedAt}>{faDate(post.publishedAt)}</time></p>
        {parsePostBody(post.body).map((b, i) => (b.type === "h" ? <h2 key={i} style={{ margin: "24px 0 8px" }}>{b.text}</h2> : <p key={i} style={{ margin: "0 0 16px", lineHeight: 1.9, overflowWrap: "anywhere" }}>{b.text}</p>))}
      </article>
    );
  }
  const posts = ctx.data.posts ?? [];
  return (
    <section style={wrap} data-blog="list" aria-labelledby="blog-h">
      <h1 id="blog-h" style={{ margin: "0 0 16px" }}>وبلاگ</h1>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 16 }}>
        {posts.map((p) => (
          <li key={p.slug} style={{ border: edge, borderRadius: 10, padding: "14px 16px" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: "1.2em" }}><a href={ctx.href(`/blog/${encodeURIComponent(p.slug)}`)} style={{ color: "inherit", textDecoration: "underline" }}>{p.title}</a></h2>
            <p style={{ margin: "0 0 8px" }}><time dateTime={p.publishedAt}>{faDate(p.publishedAt)}</time></p>
            {p.excerpt && <p style={{ margin: 0, overflowWrap: "anywhere" }}>{p.excerpt}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
