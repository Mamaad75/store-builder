import { describe, expect, it } from "vitest";
import { parsePostBody, postInputSchema } from "./blog.js";

describe("blog post text", () => {
  it("makes headings and paragraphs; single line breaks stay inside a paragraph; markup is just text", () => {
    expect(parsePostBody("## مقدمه\nخط اول\nخط دوم\n\nپاراگراف <b>دوم</b>\r\n\n##   بخش بعد  \nپایان")).toEqual([
      { type: "h", text: "مقدمه" },
      { type: "p", text: "خط اول خط دوم" },
      { type: "p", text: "پاراگراف <b>دوم</b>" },
      { type: "h", text: "بخش بعد" },
      { type: "p", text: "پایان" },
    ]);
    expect(parsePostBody("##")).toEqual([{ type: "p", text: "##" }]);
    expect(parsePostBody("   \n\n")).toEqual([]);
  });
  it("validates and cleans the input; unknown fields are refused", () => {
    const ok = postInputSchema.parse({ title: "  چگونه چای دم کنیم‮ ", body: "متن کامل مقاله درباره دم کردن چای" });
    expect(ok).toMatchObject({ title: "چگونه چای دم کنیم", excerpt: "", status: "DRAFT" });
    expect(postInputSchema.safeParse({ title: "ab", body: "متن کامل مقاله درباره دم کردن چای" }).success).toBe(false);
    expect(postInputSchema.safeParse({ title: "عنوان خوب", body: "کوتاه" }).success).toBe(false);
    expect(postInputSchema.safeParse({ title: "عنوان خوب", body: "x".repeat(10_001) }).success).toBe(false);
    expect(postInputSchema.safeParse({ title: "عنوان خوب", body: "متن کامل مقاله درباره چای", slug: "x" }).success).toBe(false);
  });
});
