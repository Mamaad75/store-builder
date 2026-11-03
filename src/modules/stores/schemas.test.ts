import { describe, expect, it } from "vitest";
import { createStoreSchema, updateStoreSchema } from "./schemas";

describe("store schemas", () => {
  it("accepts a valid create input and trims the name", () => {
    expect(createStoreSchema.parse({ name: "  قهوه  ", templateKey: "coffee" })).toEqual({ name: "قهوه", templateKey: "coffee" });
  });
  it.each([
    [{ name: "", templateKey: "coffee" }],
    [{ name: "x".repeat(81), templateKey: "coffee" }],
    [{ name: "x", templateKey: "../etc" }],
    [{ name: "x", templateKey: "coffee", ownerId: "someone" }],
    [{ name: "x", templateKey: "coffee", status: "PUBLISHED" }],
  ])("rejects invalid create input %j", (input) => {
    expect(createStoreSchema.safeParse(input).success).toBe(false);
  });
  it.each(["ownerId", "status", "publishedVersionId", "templateVersionId", "id", "draftRevision", "settings"])(
    "rejects mass-assignment of %s on update",
    (key) => {
      expect(updateStoreSchema.safeParse({ name: "ok", [key]: "x" }).success).toBe(false);
    },
  );
  it("rejects unknown nested keys and unsafe values", () => {
    expect(updateStoreSchema.safeParse({ contact: { phone: "1", evil: "x" } }).success).toBe(false);
    expect(updateStoreSchema.safeParse({ primaryColor: "red" }).success).toBe(false);
    expect(updateStoreSchema.safeParse({ social: { instagram: "javascript:alert(1)" } }).success).toBe(false);
    expect(updateStoreSchema.safeParse({ social: { instagram: "<script>" } }).success).toBe(false);
    expect(updateStoreSchema.safeParse({ contact: { email: "nope" } }).success).toBe(false);
  });
  it("accepts a valid partial update including empty optional values", () => {
    expect(updateStoreSchema.safeParse({ primaryColor: "#aabbcc", contact: { email: "" }, social: { instagram: "my.shop_1" } }).success).toBe(true);
  });
});
