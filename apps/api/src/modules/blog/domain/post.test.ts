import { describe, expect, it } from "vitest";
import { MAX_POSTS_PER_STORE } from "@store-builder/shared/modules/blog/blog";
import { canAddPost, publishedAtFor } from "./post.js";

describe("blog post rules", () => {
  it("limits the posts of a store", () => {
    expect(canAddPost(MAX_POSTS_PER_STORE - 1)).toBe(true);
    expect(canAddPost(MAX_POSTS_PER_STORE)).toBe(false);
  });
  it("stamps the first publication date and keeps it afterwards", () => {
    const t1 = new Date("2026-11-01T00:00:00Z");
    const t2 = new Date("2026-11-20T00:00:00Z");
    expect(publishedAtFor("DRAFT", null, t1)).toBeNull();
    expect(publishedAtFor("PUBLISHED", null, t1)).toEqual(t1);
    expect(publishedAtFor("PUBLISHED", t1, t2)).toEqual(t1);
    expect(publishedAtFor("DRAFT", t1, t2)).toEqual(t1); // unpublished: the date is remembered
  });
});
