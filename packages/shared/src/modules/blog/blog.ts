import { z } from "zod";
import { cleanText } from "../../lib/clean-text.js";

/**
 * The store blog: short articles (title, optional summary, plain text with `## ` headings). A post marked PUBLISHED goes live with the next
 * store publish, like every other change to the site. Text only: nothing a merchant types is ever treated as HTML.
 */
export const POST_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const POST_STATUS_LABELS: Readonly<Record<PostStatus, string>> = { DRAFT: "پیش‌نویس", PUBLISHED: "آمادهٔ انتشار" };

export const MAX_POSTS_PER_STORE = 50;
export const POST_TITLE_MAX = 120;
export const POST_EXCERPT_MAX = 300;
export const POST_BODY_MAX = 10_000;

const title = z.string().transform(cleanText).pipe(z.string().min(3, "عنوان را کامل‌تر بنویسید (حداقل ۳ حرف).").max(POST_TITLE_MAX, "عنوان حداکثر ۱۲۰ حرف باشد."));
const excerpt = z.string().transform(cleanText).pipe(z.string().max(POST_EXCERPT_MAX, "خلاصه حداکثر ۳۰۰ حرف باشد."));
const body = z.string().transform(cleanText).pipe(z.string().min(20, "متن مقاله را کامل‌تر بنویسید (حداقل ۲۰ حرف).").max(POST_BODY_MAX, "متن مقاله بیش از حد طولانی است (حداکثر ۱۰٬۰۰۰ حرف)."));

export const postInputSchema = z.object({ title, excerpt: excerpt.default(""), body, status: z.enum(POST_STATUSES).default("DRAFT") }).strict();
export type PostInput = z.infer<typeof postInputSchema>;

export type PostBlock = { type: "h"; text: string } | { type: "p"; text: string };

/**
 * Plain text to blocks: a line starting with `## ` is a heading; other lines are paragraphs separated by blank lines (single line breaks
 * inside a paragraph are kept as spaces). Pure; the page renders each block as text, never as markup.
 */
export function parsePostBody(text: string): PostBlock[] {
  const blocks: PostBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") flush();
    else if (/^##\s+\S/.test(line)) {
      flush();
      blocks.push({ type: "h", text: line.replace(/^##\s+/, "") });
    } else para.push(line);
  }
  flush();
  return blocks;
}
