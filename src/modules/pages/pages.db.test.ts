import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { setMediaStorageForTests } from "@/lib/storage";
import { MemoryRateLimiter } from "@/modules/auth/rate-limit";
import { uploadMedia } from "@/modules/media/service";
import { createProduct } from "@/modules/products/service";
import { attachProductImage } from "@/modules/media/service";
import { readPublishedStorefront } from "@/modules/storefront/published";
import { getDraftPreview } from "@/modules/storefront/service";
import { ConflictError, NotFoundError, ValidationError } from "@/modules/stores/errors";
import { getStore, updateStore } from "@/modules/stores/service";
import { MAX_SECTIONS_PER_PAGE, type EditorSpec } from "@/templates/editor";
import { generalTemplate } from "@/templates/general";
import { setExtraTemplatesForTests } from "@/templates/registry";
import { makeMedia, prisma, resetDb } from "@/test/db-helpers";
import { revision, twoTenants, validProduct } from "@/test/catalog-helpers";
import { MemoryMediaStorage } from "@/test/memory-storage";
import sharp from "sharp";
import { PageRepository } from "./repository";
import { PageNeedsRecoveryError, SectionLimitError, UnsupportedTemplateError } from "./errors";
import { addSection, getPageEditor, listPages, moveSection, recoverPage, removeSection, setPageVisibility, setSectionImage, updateSection } from "./service";

beforeEach(resetDb);
afterEach(() => {
  setExtraTemplatesForTests([]);
  setMediaStorageForTests(undefined);
});
afterAll(() => prisma.$disconnect());

const row = (storeId: string, type: string) => prisma.page.findFirstOrThrow({ where: { storeId, type: type as never } });
const pageRev = async (storeId: string, type: string) => (await row(storeId, type)).revision;
const types = async (storeId: string, type: string) => ((await row(storeId, type)).sections as { type: string }[]).map((s) => s.type);
const ids = async (storeId: string, type: string) => ((await row(storeId, type)).sections as { id: string }[]).map((s) => s.id);
const photo = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "teal" } }).jpeg().toBuffer();

/** Everything a successful edit must change, and everything a refused/no-op edit must leave alone. */
async function snapshot(storeId: string) {
  return JSON.stringify({ d: await revision(storeId), pages: await prisma.page.findMany({ where: { storeId }, orderBy: { type: "asc" } }) });
}

describe("reading pages", () => {
  it("lists the five pages of a general store with their capabilities", async () => {
    const { a, a1 } = await twoTenants();
    const { supported, pages } = await listPages(a.id, a1);
    expect(supported).toBe(true);
    expect(pages.map((p) => p.type).sort()).toEqual(["ABOUT", "CONTACT", "HOME", "PRODUCTS", "PRODUCT_DETAIL"]);
    expect(pages.find((p) => p.type === "HOME")).toMatchObject({ canHide: false, isVisible: true, sectionCount: 4, invalidCount: 0 });
    expect(pages.find((p) => p.type === "ABOUT")!.canHide).toBe(true);
  });

  it("every seeded general page is fully valid and approved (no recovery needed out of the box)", async () => {
    const { a, a1 } = await twoTenants();
    for (const t of ["HOME", "PRODUCTS", "PRODUCT_DETAIL", "ABOUT", "CONTACT"]) {
      const v = await getPageEditor(a.id, a1, t);
      expect(v.issues, t).toEqual([]);
      expect(v.sections.length, t).toBeGreaterThan(0);
    }
  });

  it("a store whose template has no editor yet (coffee, until phase 9) is reported as unsupported and cannot be edited", async () => {
    const { a, a2 } = await twoTenants();
    expect((await listPages(a.id, a2)).supported).toBe(false);
    await expect(getPageEditor(a.id, a2, "HOME")).rejects.toBeInstanceOf(UnsupportedTemplateError);
    const before = await snapshot(a2);
    await expect(addSection(a.id, a2, "HOME", { type: "richText" }, 1)).rejects.toBeInstanceOf(UnsupportedTemplateError);
    expect(await snapshot(a2)).toBe(before);
  });
});

describe("tenant isolation", () => {
  it("foreign store, missing store, malformed ids and unknown page types are all the same NotFoundError for every operation", async () => {
    const { a, b, a1 } = await twoTenants();
    const calls: [string, () => Promise<unknown>][] = [
      ["list", () => listPages(b.id, a1)],
      ["get", () => getPageEditor(b.id, a1, "HOME")],
      ["add", () => addSection(b.id, a1, "ABOUT", { type: "richText" }, 1)],
      ["update", () => updateSection(b.id, a1, "ABOUT", "x", {}, 1)],
      ["remove", () => removeSection(b.id, a1, "ABOUT", "x", 1)],
      ["move", () => moveSection(b.id, a1, "ABOUT", "x", "up", 1)],
      ["visibility", () => setPageVisibility(b.id, a1, "ABOUT", false, 1)],
      ["recover", () => recoverPage(b.id, a1, "ABOUT", 1)],
      ["missing store", () => getPageEditor(a.id, "ckdoesnotexist000000000000", "HOME")],
      ["bad store id", () => getPageEditor(a.id, "../x", "HOME")],
      ["unknown page", () => getPageEditor(a.id, a1, "ADMIN")],
    ];
    const before = await snapshot(a1);
    for (const [name, call] of calls) await expect(call(), name).rejects.toBeInstanceOf(NotFoundError);
    expect(await snapshot(a1)).toBe(before);
  });
});

describe("repository ownership (defence in depth, independent of the service)", () => {
  it("every read is bound to the owner in SQL", async () => {
    const { a, b, a1 } = await twoTenants();
    expect(() => new PageRepository("")).toThrow();
    expect(await new PageRepository(b.id).list(a1)).toEqual([]);
    expect(await new PageRepository(b.id).find(a1, "HOME")).toBeNull();
    expect(await new PageRepository(b.id).templateOf(a1)).toBeNull();
    expect(await new PageRepository(b.id).readyMedia(a1, ["x"])).toEqual([]);
    expect(await new PageRepository(a.id).find(a1, "HOME")).not.toBeNull();
  });
});

describe("adding sections", () => {
  it("adds an approved section with a server-generated id and valid default props; bumps both revisions once", async () => {
    const { a, a1 } = await twoTenants();
    const [d0, p0] = [await revision(a1), await pageRev(a1, "ABOUT")];
    const r = await addSection(a.id, a1, "ABOUT", { type: "callToAction" }, p0);
    expect(r).toEqual({ changed: true, revision: p0 + 1 });
    expect(await revision(a1)).toBe(d0 + 1);
    const v = await getPageEditor(a.id, a1, "ABOUT");
    const added = v.sections.at(-1)!;
    expect(added.type).toBe("callToAction");
    expect(added.id).toMatch(/^s[0-9a-f]{12}$/);
    expect(v.issues).toEqual([]);
  });

  it("refuses types the template does not approve for the page, unknown types and a second singleton", async () => {
    const { a, a1 } = await twoTenants();
    const p = await pageRev(a1, "ABOUT");
    for (const type of ["productGrid", "productDetail", "hero", "carousel", "", null, 5]) {
      await expect(addSection(a.id, a1, "ABOUT", { type }, p), String(type)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(addSection(a.id, a1, "HOME", { type: "hero" }, await pageRev(a1, "HOME"))).rejects.toBeInstanceOf(ValidationError); // hero is a singleton and exists
    await expect(addSection(a.id, a1, "PRODUCT_DETAIL", { type: "richText" }, await pageRev(a1, "PRODUCT_DETAIL"))).rejects.toBeInstanceOf(ValidationError); // locked page
    expect(await types(a1, "ABOUT")).toEqual(["richText"]);
  });

  it(`enforces the maximum of ${MAX_SECTIONS_PER_PAGE} sections per page`, async () => {
    const { a, a1 } = await twoTenants();
    for (let i = 1; i < MAX_SECTIONS_PER_PAGE; i++) await addSection(a.id, a1, "ABOUT", { type: "richText" }, await pageRev(a1, "ABOUT"));
    expect((await types(a1, "ABOUT")).length).toBe(MAX_SECTIONS_PER_PAGE);
    const before = await snapshot(a1);
    await expect(addSection(a.id, a1, "ABOUT", { type: "richText" }, await pageRev(a1, "ABOUT"))).rejects.toBeInstanceOf(SectionLimitError);
    expect(await snapshot(a1)).toBe(before);
  });
});

describe("editing sections", () => {
  it("updates props with the strict schema; the type and hidden fields come from the stored section, not the client", async () => {
    const { a, a1 } = await twoTenants();
    const home = await getPageEditor(a.id, a1, "HOME");
    const hero = home.sections.find((s) => s.type === "hero")!;
    const r = await updateSection(a.id, a1, "HOME", hero.id, { title: "عنوان جدید", type: "callToAction", id: "evil", imageId: undefined }, home.revision).catch((e) => e);
    // an unknown key (`type`/`id`) is rejected by the strict schema instead of being applied
    expect(r).toBeInstanceOf(ValidationError);
    const ok = await updateSection(a.id, a1, "HOME", hero.id, { title: "عنوان جدید" }, home.revision);
    expect(ok.changed).toBe(true);
    const after = (await getPageEditor(a.id, a1, "HOME")).sections.find((s) => s.id === hero.id)!;
    expect(after).toMatchObject({ type: "hero", props: { title: "عنوان جدید", imageId: null, buttonLink: "/products" } });
  });

  it.each([
    ["empty required title", { title: "" }],
    ["title too long", { title: "x".repeat(121) }],
    ["javascript: link", { buttonLink: "javascript:alert(1)" }],
    ["external link", { buttonLink: "https://evil.example" }],
    ["protocol-relative link", { buttonLink: "//evil.example" }],
    ["wrong type", { title: 5 }],
    ["unknown prop", { onClick: "x" }],
    ["html is just text but unknown keys are not", { style: "background:url(x)" }],
  ])("rejects invalid props (%s) and writes nothing", async (_n, props) => {
    const { a, a1 } = await twoTenants();
    const v = await getPageEditor(a.id, a1, "HOME");
    const hero = v.sections.find((s) => s.type === "hero")!;
    const before = await snapshot(a1);
    await expect(updateSection(a.id, a1, "HOME", hero.id, props, v.revision)).rejects.toBeInstanceOf(ValidationError);
    expect(await snapshot(a1)).toBe(before);
  });

  it("an update that changes nothing is a no-op: no write, no draftRevision bump, no page revision bump", async () => {
    const { a, a1 } = await twoTenants();
    const v = await getPageEditor(a.id, a1, "HOME");
    const hero = v.sections.find((s) => s.type === "hero")!;
    const before = await snapshot(a1);
    const r = await updateSection(a.id, a1, "HOME", hero.id, { title: hero.props.title }, v.revision);
    expect(r).toEqual({ changed: false, revision: v.revision });
    expect(await snapshot(a1)).toBe(before);
  });

  it("removes a section; a section the page cannot work without (product grid, contact info, product detail) is never removed", async () => {
    const { a, a1 } = await twoTenants();
    const home = await getPageEditor(a.id, a1, "HOME");
    const cta = home.sections.find((s) => s.type === "callToAction")!;
    await removeSection(a.id, a1, "HOME", cta.id, home.revision);
    expect(await types(a1, "HOME")).not.toContain("callToAction");

    for (const [page, type] of [["PRODUCTS", "productGrid"], ["CONTACT", "contactInfo"], ["PRODUCT_DETAIL", "productDetail"]] as const) {
      const v = await getPageEditor(a.id, a1, page);
      const s = v.sections.find((x) => x.type === type)!;
      await expect(removeSection(a.id, a1, page, s.id, v.revision), page).rejects.toBeInstanceOf(ValidationError);
      expect(await types(a1, page)).toContain(type);
    }
    // a second copy of a non-singleton required section could be removed, but the last one never
    await expect(removeSection(a.id, a1, "ABOUT", "missing-id", await pageRev(a1, "ABOUT"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("moves sections up and down; moving past an edge is a no-op", async () => {
    const { a, a1 } = await twoTenants();
    const home = await getPageEditor(a.id, a1, "HOME");
    const original = home.sections.map((s) => s.id);
    await moveSection(a.id, a1, "HOME", original[1], "up", home.revision);
    expect(await ids(a1, "HOME")).toEqual([original[1], original[0], original[2], original[3]]);
    const r1 = await pageRev(a1, "HOME");
    await moveSection(a.id, a1, "HOME", original[1], "down", r1);
    expect(await ids(a1, "HOME")).toEqual(original);

    const before = await snapshot(a1);
    const edge = await moveSection(a.id, a1, "HOME", original[0], "up", await pageRev(a1, "HOME"));
    expect(edge.changed).toBe(false);
    expect(await snapshot(a1)).toBe(before);
    await expect(moveSection(a.id, a1, "HOME", original[0], "sideways", await pageRev(a1, "HOME"))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("draft revision rules and explicit conflicts", () => {
  it("a stale form gets ConflictError and nothing changes, including draftRevision (the bump is rolled back)", async () => {
    const { a, a1 } = await twoTenants();
    const v = await getPageEditor(a.id, a1, "ABOUT");
    await addSection(a.id, a1, "ABOUT", { type: "callToAction" }, v.revision); // someone else changed the page
    const before = await snapshot(a1);
    for (const op of [
      () => addSection(a.id, a1, "ABOUT", { type: "richText" }, v.revision),
      () => updateSection(a.id, a1, "ABOUT", v.sections[0]!.id, { title: "stale" }, v.revision),
      () => removeSection(a.id, a1, "ABOUT", v.sections[0]!.id, v.revision),
      () => moveSection(a.id, a1, "ABOUT", v.sections[0]!.id, "down", v.revision),
      () => setPageVisibility(a.id, a1, "ABOUT", false, v.revision),
      () => recoverPage(a.id, a1, "ABOUT", v.revision),
    ]) await expect(op()).rejects.toBeInstanceOf(ConflictError);
    expect(await snapshot(a1)).toBe(before);
  });

  it("two simultaneous edits from the same loaded revision: exactly one wins, the other is a ConflictError", async () => {
    const { a, a1 } = await twoTenants();
    const v = await getPageEditor(a.id, a1, "ABOUT");
    const results = await Promise.allSettled([
      addSection(a.id, a1, "ABOUT", { type: "callToAction" }, v.revision),
      addSection(a.id, a1, "ABOUT", { type: "richText" }, v.revision),
      updateSection(a.id, a1, "ABOUT", v.sections[0]!.id, { title: "x" }, v.revision),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof ConflictError)).toBe(true);
    expect((await types(a1, "ABOUT")).length).toBeLessThanOrEqual(2);
    expect(await pageRev(a1, "ABOUT")).toBe(v.revision + 1);
  });

  it("edits of different pages are independent (no false conflict), and product edits do not conflict with page edits", async () => {
    const { a, a1 } = await twoTenants();
    const about = await getPageEditor(a.id, a1, "ABOUT");
    const contact = await getPageEditor(a.id, a1, "CONTACT");
    await addSection(a.id, a1, "CONTACT", { type: "richText" }, contact.revision);
    await createProduct(a.id, a1, validProduct()); // bumps draftRevision, not the page revision
    await expect(addSection(a.id, a1, "ABOUT", { type: "richText" }, about.revision)).resolves.toMatchObject({ changed: true });
  });
});

describe("page visibility", () => {
  it("hides and shows optional pages; HOME and PRODUCTS can never be hidden (application and database)", async () => {
    const { a, a1 } = await twoTenants();
    const r0 = await pageRev(a1, "ABOUT");
    await setPageVisibility(a.id, a1, "ABOUT", false, r0);
    expect((await row(a1, "ABOUT")).isVisible).toBe(false);
    expect((await getDraftPreview(a.id, a1)).data.pages.map((p) => p.type)).not.toContain("ABOUT");
    await setPageVisibility(a.id, a1, "ABOUT", true, r0 + 1);
    expect((await row(a1, "ABOUT")).isVisible).toBe(true);

    for (const t of ["HOME", "PRODUCTS"]) {
      await expect(setPageVisibility(a.id, a1, t, false, await pageRev(a1, t)), t).rejects.toBeInstanceOf(ValidationError);
      await expect(prisma.page.updateMany({ where: { storeId: a1, type: t as never }, data: { isVisible: false } }), `db ${t}`).rejects.toThrow();
      expect((await row(a1, t)).isVisible).toBe(true);
    }
    expect(await setPageVisibility(a.id, a1, "ABOUT", true, await pageRev(a1, "ABOUT"))).toMatchObject({ changed: false }); // already visible: no-op
  });
});

describe("legacy and invalid section JSON is never discarded", () => {
  const legacy = [
    { id: "ok1", type: "richText", props: { title: "سالم", body: "متن" } },
    { id: "old", type: "carousel", props: { images: ["a", "b"] } }, // unknown type
    { id: "bad", type: "richText", props: { title: 5 } }, // invalid props
    { id: "ok1", type: "richText", props: { title: "تکراری", body: "" } }, // duplicate id
    { id: "wrong", type: "productGrid", props: { title: "x" } }, // valid, but not approved for ABOUT
    "garbage",
    null,
  ];

  it("shows an explicit error state and refuses every edit until recovery; the stored JSON stays byte-identical", async () => {
    const { a, a1 } = await twoTenants();
    await prisma.page.updateMany({ where: { storeId: a1, type: "ABOUT" }, data: { sections: legacy as never } });
    const v = await getPageEditor(a.id, a1, "ABOUT");
    expect(v.sections.map((s) => s.id)).toEqual(["ok1"]);
    expect(v.issues.map((i) => i.reason)).toEqual(["unsupported_type", "invalid_props", "invalid_envelope", "not_allowed", "invalid_envelope", "invalid_envelope"]);
    expect(v.issues[0]!.preview).toContain("carousel");

    const before = await snapshot(a1);
    for (const op of [
      () => addSection(a.id, a1, "ABOUT", { type: "richText" }, v.revision),
      () => updateSection(a.id, a1, "ABOUT", "ok1", { title: "x" }, v.revision),
      () => removeSection(a.id, a1, "ABOUT", "ok1", v.revision),
      () => moveSection(a.id, a1, "ABOUT", "ok1", "up", v.revision),
      () => setPageVisibility(a.id, a1, "ABOUT", false, v.revision), // visibility keeps sections untouched but is still refused: one clear rule
    ]) {
      const e = await op().then(() => null, (x) => x);
      expect(e, "edit must be refused").toBeInstanceOf(PageNeedsRecoveryError);
    }
    expect(await snapshot(a1)).toBe(before);
    expect((await row(a1, "ABOUT")).sections).toEqual(legacy);
  });

  it("explicit recovery MOVES the invalid entries verbatim to legacySections; valid sections stay; nothing is lost", async () => {
    const { a, a1 } = await twoTenants();
    await prisma.page.updateMany({ where: { storeId: a1, type: "ABOUT" }, data: { sections: legacy as never } });
    const v = await getPageEditor(a.id, a1, "ABOUT");
    const r = await recoverPage(a.id, a1, "ABOUT", v.revision);
    expect(r.changed).toBe(true);
    const page = await row(a1, "ABOUT");
    expect(page.sections).toEqual([legacy[0]]);
    const archived = page.legacySections as { raw: unknown; reason: string }[];
    expect(archived.map((x) => x.raw)).toEqual([legacy[1], legacy[2], legacy[3], legacy[4], legacy[5], null]);
    expect(archived.map((x) => x.reason)).toEqual(["unsupported_type", "invalid_props", "invalid_envelope", "not_allowed", "invalid_envelope", "invalid_envelope"]);
    expect((await getPageEditor(a.id, a1, "ABOUT")).issues).toEqual([]);
    expect((await getPageEditor(a.id, a1, "ABOUT")).archivedCount).toBe(6);
    await expect(addSection(a.id, a1, "ABOUT", { type: "richText" }, page.revision)).resolves.toMatchObject({ changed: true }); // editable again

    const before = await snapshot(a1);
    expect((await recoverPage(a.id, a1, "ABOUT", await pageRev(a1, "ABOUT"))).changed).toBe(false); // nothing left to recover: no-op
    expect(await snapshot(a1)).toBe(before);
  });

  it("a stored value that is not an array at all is archived whole and the page gets a working (empty or required-section) list", async () => {
    const { a, a1 } = await twoTenants();
    for (const raw of [{ oops: true }, "text", 5, null]) {
      await prisma.page.updateMany({ where: { storeId: a1, type: "PRODUCTS" }, data: { sections: raw as never, legacySections: null as never } });
      const v = await getPageEditor(a.id, a1, "PRODUCTS");
      expect(v.issues[0]!.reason).toBe("not_an_array");
      await recoverPage(a.id, a1, "PRODUCTS", v.revision);
      const page = await row(a1, "PRODUCTS");
      expect((page.legacySections as { raw: unknown }[])[0]!.raw).toEqual(raw);
      expect((page.sections as { type: string }[]).map((s) => s.type)).toEqual(["productGrid"]); // the required section is re-created with defaults
    }
  });

  it("legacy pages render safely in the preview (invalid entries skipped, database untouched)", async () => {
    const { a, a1 } = await twoTenants();
    await prisma.page.updateMany({ where: { storeId: a1, type: "ABOUT" }, data: { sections: legacy as never } });
    const { data, notes } = await getDraftPreview(a.id, a1);
    expect(data.pages.find((p) => p.type === "ABOUT")!.sections.map((s) => s.id)).toContain("ok1");
    expect(notes.skippedSections.length).toBeGreaterThan(0);
    expect((await row(a1, "ABOUT")).sections).toEqual(legacy);
  });
});

describe("images in sections", () => {
  async function withStorage() {
    const storage = new MemoryMediaStorage();
    setMediaStorageForTests(storage);
    return { storage, deps: { storage, limiter: new MemoryRateLimiter(), log: () => undefined } };
  }
  const heroOf = async (owner: string, store: string) => {
    const v = await getPageEditor(owner, store, "HOME");
    return { v, hero: v.sections.find((s) => s.type === "hero")! };
  };

  it("sets a READY image of the same store (validated under the lock); the preview exposes only its relative key and dimensions", async () => {
    const { a, a1 } = await twoTenants();
    const { deps } = await withStorage();
    const m = await uploadMedia(a.id, a1, await photo(), deps);
    const { v, hero } = await heroOf(a.id, a1);
    await setSectionImage(a.id, a1, "HOME", hero.id, m.id, v.revision);
    const { data } = await getDraftPreview(a.id, a1);
    expect(data.images[m.id]).toEqual({ key: m.key, width: 64, height: 48 });
    expect(JSON.stringify(data)).not.toMatch(/https?:/);
    expect((await row(a1, "HOME")).sections).toContainEqual(expect.objectContaining({ props: expect.objectContaining({ imageId: m.id }) }));
  });

  it("refuses forged references: another tenant's media, another store's media, PENDING, DELETING, unknown and malformed ids", async () => {
    const { a, b, a1, a2, b1 } = await twoTenants();
    const { deps } = await withStorage();
    const theirs = await uploadMedia(b.id, b1, await photo(), deps);
    const otherStore = await uploadMedia(a.id, a2, await photo(), deps);
    const pending = await makeMedia(a1, a.id, { status: "PENDING" });
    const deleting = await makeMedia(a1, a.id, { status: "DELETING" });
    const { v, hero } = await heroOf(a.id, a1);
    const before = await snapshot(a1);
    for (const id of [theirs.id, otherStore.id, pending.id, deleting.id, "ckfake00000000000000000000", "x".repeat(80)]) {
      await expect(setSectionImage(a.id, a1, "HOME", hero.id, id, v.revision), id).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await snapshot(a1)).toBe(before);
  });

  it("only image-capable sections accept an image; the form can never set imageId (strict props merge keeps the stored one)", async () => {
    const { a, a1 } = await twoTenants();
    const { deps } = await withStorage();
    const m = await uploadMedia(a.id, a1, await photo(), deps);
    const about = await getPageEditor(a.id, a1, "ABOUT");
    await expect(setSectionImage(a.id, a1, "ABOUT", about.sections[0]!.id, m.id, about.revision)).rejects.toBeInstanceOf(ValidationError); // richText has no image
    const { v, hero } = await heroOf(a.id, a1);
    await setSectionImage(a.id, a1, "HOME", hero.id, m.id, v.revision);
    const v2 = await getPageEditor(a.id, a1, "HOME");
    await updateSection(a.id, a1, "HOME", hero.id, { title: "عنوان" }, v2.revision);
    const stored = (await getPageEditor(a.id, a1, "HOME")).sections.find((s) => s.id === hero.id)!;
    expect("imageId" in stored.props && stored.props.imageId).toBe(m.id); // an unrelated edit keeps the image
  });

  it("replacing or clearing the image, or removing the section, releases the media (reference-aware); shared media is kept", async () => {
    const { a, a1 } = await twoTenants();
    const { deps, storage } = await withStorage();
    const m1 = await uploadMedia(a.id, a1, await photo(), deps);
    const m2 = await uploadMedia(a.id, a1, await photo(), deps);
    const { hero } = await heroOf(a.id, a1);
    let { v } = await heroOf(a.id, a1);
    await setSectionImage(a.id, a1, "HOME", hero.id, m1.id, v.revision);
    ({ v } = await heroOf(a.id, a1));
    await setSectionImage(a.id, a1, "HOME", hero.id, m2.id, v.revision); // replaces m1
    expect(await prisma.media.findUnique({ where: { id: m1.id } })).toBeNull();
    expect(storage.objects.has(m1.key)).toBe(false);

    // m2 is also a product image: clearing the hero must NOT delete it
    const p = (await createProduct(a.id, a1, validProduct())).id;
    await attachProductImage(a.id, a1, p, m2.id, deps);
    ({ v } = await heroOf(a.id, a1));
    await setSectionImage(a.id, a1, "HOME", hero.id, null, v.revision);
    expect(storage.objects.has(m2.key)).toBe(true);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: m2.id } })).status).toBe("READY");

    // an image used only by a section that is removed is deleted
    const m3 = await uploadMedia(a.id, a1, await photo(), deps);
    ({ v } = await heroOf(a.id, a1));
    await setSectionImage(a.id, a1, "HOME", hero.id, m3.id, v.revision);
    ({ v } = await heroOf(a.id, a1));
    const cta = v.sections.find((s) => s.type === "imageText")!;
    await setSectionImage(a.id, a1, "HOME", cta.id, m3.id, v.revision); // same media in two sections
    ({ v } = await heroOf(a.id, a1));
    await removeSection(a.id, a1, "HOME", cta.id, v.revision);
    expect(storage.objects.has(m3.key)).toBe(true); // the hero still uses it
    ({ v } = await heroOf(a.id, a1));
    await setSectionImage(a.id, a1, "HOME", hero.id, null, v.revision);
    expect(storage.objects.has(m3.key)).toBe(false);
  });

  it("media referenced by a section cannot be deleted through the media service either", async () => {
    const { a, a1 } = await twoTenants();
    const { deps } = await withStorage();
    const { releaseMedia } = await import("@/modules/media/service");
    const m = await uploadMedia(a.id, a1, await photo(), deps);
    const { v, hero } = await heroOf(a.id, a1);
    await setSectionImage(a.id, a1, "HOME", hero.id, m.id, v.revision);
    expect(await releaseMedia(a.id, a1, m.id, deps)).toBe("kept");
  });

  it("a section image that is not READY is never rendered", async () => {
    const { a, a1 } = await twoTenants();
    const media = await makeMedia(a1, a.id, { status: "DELETING" });
    const home = await row(a1, "HOME");
    const sections = (home.sections as { type: string; props: Record<string, unknown> }[]).map((s) => (s.type === "hero" ? { ...s, props: { ...s.props, imageId: media.id } } : s));
    await prisma.page.update({ where: { id: home.id }, data: { sections: sections as never } });
    expect((await getDraftPreview(a.id, a1)).data.images).toEqual({});
  });
});

describe("appearance: colors and typography (closed allow-lists)", () => {
  it("saves typography choices and normalises legacy settings (no typography) with the defaults", async () => {
    const { a, a1 } = await twoTenants();
    expect((await getDraftPreview(a.id, a1)).data.store.typography).toEqual({ fontFamily: "vazirmatn", sizeScale: "normal", headingWeight: 800, bodyWeight: 400 });
    await updateStore(a.id, a1, { typography: { sizeScale: "large", headingWeight: "700", bodyWeight: "500" } });
    expect((await getDraftPreview(a.id, a1)).data.store.typography).toEqual({ fontFamily: "vazirmatn", sizeScale: "large", headingWeight: 700, bodyWeight: 500 });
  });

  it.each([
    ["font family key", { fontFamily: "Comic Sans" }],
    ["external font URL", { fontFamily: "url(https://evil.example/f.woff2)" }],
    ["css injection in size", { sizeScale: "20px; background:url(x)" }],
    ["unlisted size", { sizeScale: "huge" }],
    ["unlisted heading weight", { headingWeight: 900 }],
    ["unlisted body weight", { bodyWeight: "bold" }],
    ["unknown key", { lineHeight: 2 }],
  ])("rejects %s", async (_n, typography) => {
    const { a, a1 } = await twoTenants();
    const before = await snapshot(a1);
    await expect(updateStore(a.id, a1, { typography })).rejects.toBeInstanceOf(ValidationError);
    expect(await snapshot(a1)).toBe(before);
  });

  it.each(["red", "#fff", "#12345678", "rgb(0,0,0)", "#gggggg", "url(x)", "#12345", "##123456", " #123456", "#123456;x", "var(--x)", ""])(
    "rejects the color %j (strict #RRGGBB only)",
    async (color) => {
      const { a, a1 } = await twoTenants();
      await expect(updateStore(a.id, a1, { primaryColor: color })).rejects.toBeInstanceOf(ValidationError);
    },
  );

  it("saving values that change nothing is a no-op: no write and no draftRevision bump", async () => {
    const { a, a1 } = await twoTenants();
    await updateStore(a.id, a1, { primaryColor: "#112233", typography: { sizeScale: "small" } });
    const before = await snapshot(a1);
    const store = await getStore(a.id, a1);
    await updateStore(a.id, a1, { name: store.name, primaryColor: "#112233", typography: { sizeScale: "small" } });
    expect(await snapshot(a1)).toBe(before);
  });
});

describe("draft only", () => {
  it("editing never publishes anything and never touches a published snapshot", async () => {
    const { a, a1 } = await twoTenants();
    const { data } = await getDraftPreview(a.id, a1);
    const v = await prisma.storeVersion.create({ data: { storeId: a1, number: 1, draftRevision: 1, snapshot: data as never } });
    await prisma.store.update({ where: { id: a1 }, data: { status: "PUBLISHED", publishedVersionId: v.id, publishedAt: new Date() } });
    const published = await readPublishedStorefront(a1);

    const about = await getPageEditor(a.id, a1, "ABOUT");
    await addSection(a.id, a1, "ABOUT", { type: "callToAction" }, about.revision);
    await updateSection(a.id, a1, "ABOUT", about.sections[0]!.id, { title: "تغییر پیش‌نویس" }, about.revision + 1);
    await updateStore(a.id, a1, { primaryColor: "#abcdef", typography: { sizeScale: "large" } });
    await setPageVisibility(a.id, a1, "CONTACT", false, await pageRev(a1, "CONTACT"));

    expect(await readPublishedStorefront(a1)).toEqual(published);
    expect(JSON.stringify(await readPublishedStorefront(a1))).not.toContain("تغییر پیش‌نویس");
    expect((await getDraftPreview(a.id, a1)).data.pages.find((p) => p.type === "ABOUT")!.sections).toHaveLength(2); // the draft preview reflects it immediately
    expect(await prisma.storeVersion.count({ where: { storeId: a1 } })).toBe(1);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a1 } })).status).toBe("PUBLISHED");
  });
});

describe("template-aware editing (phase 9 readiness)", () => {
  const coffeeEditor: EditorSpec = {
    pages: {
      HOME: { allowed: ["richText", "featuredProducts"], singletons: [], required: [] },
      PRODUCTS: { allowed: ["productGrid"], singletons: ["productGrid"], required: ["productGrid"] },
      PRODUCT_DETAIL: { allowed: ["productDetail"], singletons: ["productDetail"], required: ["productDetail"] },
      ABOUT: { allowed: ["richText"], singletons: [], required: [] },
      CONTACT: { allowed: ["contactInfo"], singletons: ["contactInfo"], required: ["contactInfo"] },
    },
  };

  it("a template brings its own approved sections: the same editing core follows the template's spec, not a hardcoded list", async () => {
    const { a, a2 } = await twoTenants(); // a2 is a coffee store
    setExtraTemplatesForTests([{ ...generalTemplate, key: "coffee", name: "قهوه", editor: coffeeEditor }]);
    expect((await listPages(a.id, a2)).supported).toBe(true);
    const home = await getPageEditor(a.id, a2, "HOME");
    expect(home.rules.allowed).toEqual(["richText", "featuredProducts"]);
    // coffee's seed HOME has hero/imageText/callToAction which this template does not approve: explicit recovery state
    expect(home.issues.some((i) => i.reason === "not_allowed")).toBe(true);
    await expect(addSection(a.id, a2, "HOME", { type: "richText" }, home.revision)).rejects.toBeInstanceOf(PageNeedsRecoveryError);
    await recoverPage(a.id, a2, "HOME", home.revision);
    await expect(addSection(a.id, a2, "HOME", { type: "hero" }, await pageRev(a2, "HOME"))).rejects.toBeInstanceOf(ValidationError); // general allows hero, coffee does not
    await expect(addSection(a.id, a2, "HOME", { type: "richText" }, await pageRev(a2, "HOME"))).resolves.toMatchObject({ changed: true });
  });
});
