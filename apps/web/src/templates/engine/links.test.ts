import { describe, expect, it } from "vitest";
import { buildContactLinks, makeHref } from "./links";

const empty = { phone: "", email: "", address: "" };
const noSocial = { instagram: "", telegram: "", whatsapp: "" };

describe("makeHref", () => {
  const h = makeHref("/preview/abc");
  it("joins the base path", () => {
    expect(h("/")).toBe("/preview/abc");
    expect(h("/products")).toBe("/preview/abc/products");
    expect(h("/products?page=2")).toBe("/preview/abc/products?page=2");
  });
  it("never produces an external or protocol-relative URL", () => {
    expect(h("//evil.example")).toBe("/preview/abc");
    expect(h("https://evil.example")).toBe("/preview/abc");
    expect(h("javascript:alert(1)")).toBe("/preview/abc");
  });
  it("works with an empty base (public host)", () => {
    expect(makeHref("")("/")).toBe("/");
    expect(makeHref("")("/about")).toBe("/about");
  });
});

describe("buildContactLinks", () => {
  it("builds fixed-scheme links and normalises Persian digits", () => {
    const l = buildContactLinks({ phone: "۰۲۱-۱۲۳۴۵۶۷۸", email: "a@b.co", address: "تهران" }, { instagram: "@shop.x", telegram: "shop_x", whatsapp: "+98 912 000 0000" });
    expect(l.find((x) => x.kind === "phone")?.href).toBe("tel:02112345678");
    expect(l.find((x) => x.kind === "email")?.href).toBe("mailto:a@b.co");
    expect(l.find((x) => x.kind === "instagram")?.href).toBe("https://www.instagram.com/shop.x");
    expect(l.find((x) => x.kind === "telegram")?.href).toBe("https://t.me/shop_x");
    expect(l.find((x) => x.kind === "whatsapp")?.href).toBe("https://wa.me/989120000000");
    expect(l.find((x) => x.kind === "address")?.href).toBeUndefined();
  });
  it("omits empty values and drops anything that could smuggle a scheme or markup", () => {
    expect(buildContactLinks(empty, noSocial)).toEqual([]);
    const l = buildContactLinks(
      { phone: "javascript:alert(1)", email: "x@y.z\"><script>", address: "" },
      { instagram: "javascript:alert(1)", telegram: "a/b", whatsapp: "<svg>" },
    );
    expect(l).toEqual([]);
  });
});
