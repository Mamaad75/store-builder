import { parsePostBody } from "@store-builder/shared/modules/blog/blog";
import type { RenderContext } from "../types";
import c from "./content.module.css";

const faDate = (iso: string) => new Date(iso).toLocaleDateString("fa-IR", { dateStyle: "long" });

/**
 * The store blog inside whatever theme the store uses: the theme's own Layout (header, footer, colours, fonts) wraps this article markup, drawn
 * with the theme's own tokens (content.module.css). Post text is rendered as text blocks (headings and paragraphs), never as HTML.
 */
export default function BlogView({ ctx }: { ctx: RenderContext }) {
  const blog = ctx.blog;
  if (!blog) return null;
  if (blog.view === "post") {
    const { post } = blog;
    return (
      <article className={`${c.wrap} ${c.scope}`} data-blog="post">
        <nav aria-label="مسیر"><a href={ctx.href("/blog")} className={c.back}>← همهٔ مقاله‌ها</a></nav>
        <h1 className={c.title}>{post.title}</h1>
        <p className={c.muted}><time dateTime={post.publishedAt}>{faDate(post.publishedAt)}</time></p>
        {parsePostBody(post.body).map((b, i) => (b.type === "h" ? <h2 key={i} className={c.h2}>{b.text}</h2> : <p key={i} className={c.p}>{b.text}</p>))}
      </article>
    );
  }
  const posts = ctx.data.posts ?? [];
  return (
    <section className={`${c.wrap} ${c.scope}`} data-blog="list" aria-labelledby="blog-h">
      <h1 id="blog-h" className={c.title}>وبلاگ</h1>
      <ol className={c.stack}>
        {posts.map((p) => (
          <li key={p.slug} className={c.card}>
            <h2><a href={ctx.href(`/blog/${encodeURIComponent(p.slug)}`)}>{p.title}</a></h2>
            <p className={c.muted}><time dateTime={p.publishedAt}>{faDate(p.publishedAt)}</time></p>
            {p.excerpt && <p className={c.p} style={{ margin: 0 }}>{p.excerpt}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
