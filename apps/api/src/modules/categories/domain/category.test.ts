import { describe, expect, it } from "vitest";
import { MAX_CATEGORIES_PER_STORE } from "@store-builder/shared/modules/categories/schemas";
import { CatalogLimitError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { DUPLICATE_NAME, assertBelowLimit, assertUniqueName, duplicateKeyError, newSlug, type CategoryRef } from "./category.js";

const cat = (id: string, name: string, slug = id): CategoryRef => ({ id, name, slug });

describe("category rules", () => {
  it("allows categories up to the per-store limit and refuses the next one", () => {
    expect(() => assertBelowLimit(MAX_CATEGORIES_PER_STORE - 1)).not.toThrow();
    expect(() => assertBelowLimit(MAX_CATEGORIES_PER_STORE)).toThrow(CatalogLimitError);
  });

  it("treats names as equal after Persian/Arabic letter, digit and harakat normalisation", () => {
    const existing = [cat("c1", "علی ۱۲")];
    for (const dup of ["علي 12", "عَلی ١٢", "علی ۱۲"]) {
      const err = (() => {
        try {
          assertUniqueName(existing, dup);
        } catch (e) {
          return e;
        }
      })();
      expect(err, dup).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fieldErrors).toEqual({ name: [DUPLICATE_NAME] });
    }
    expect(() => assertUniqueName(existing, "علی ۱۳")).not.toThrow();
  });

  it("a rename may keep the category's own name (only other categories count)", () => {
    const existing = [cat("c1", "چای"), cat("c2", "قهوه")];
    expect(() => assertUniqueName(existing, "چای", "c1")).not.toThrow();
    expect(() => assertUniqueName(existing, "قهوه", "c1")).toThrow(ValidationError);
  });

  it("derives the slug from the name and never reuses a taken slug", () => {
    expect(newSlug("نوشیدنی  گرم", [])).toBe("نوشیدنی-گرم");
    const taken = newSlug("نوشیدنی گرم", [cat("c1", "x", "نوشیدنی-گرم")]);
    expect(taken).not.toBe("نوشیدنی-گرم");
    expect(taken.startsWith("نوشیدنی-گرم")).toBe(true);
    expect(newSlug("!!!", [])).toBe("category"); // nothing sluggable left: the fallback
  });

  it("maps a database duplicate to the field the user can act on", () => {
    expect(duplicateKeyError("name").fieldErrors).toEqual({ name: [DUPLICATE_NAME] });
    expect(duplicateKeyError("slug").fieldErrors).toEqual({ slug: [DUPLICATE_NAME] });
    expect(Object.keys(duplicateKeyError(null).fieldErrors)).toEqual(["_form"]);
  });
});
