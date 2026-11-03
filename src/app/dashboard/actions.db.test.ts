import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeUser, prisma, resetDb } from "@/test/db-helpers";
import { createStore } from "@/modules/stores/service";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import { createStoreAction, deleteStoreAction, updateStoreAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const loginAs = (userId: string | null) => authMock.mockResolvedValue(userId ? { user: { id: userId } } : null);

beforeEach(async () => {
  await resetDb();
  authMock.mockReset();
});
afterAll(() => prisma.$disconnect());

async function setup() {
  const a = await makeUser();
  const b = await makeUser();
  const aStore = await createStore(a.id, { name: "A shop", templateKey: "coffee" });
  const bStore = await createStore(b.id, { name: "B shop", templateKey: "general" });
  return { a, b, aId: aStore.id, bId: bStore.id };
}

describe("Server Actions: unauthenticated", () => {
  it("every action redirects to /login and changes nothing", async () => {
    const { bId } = await setup();
    loginAs(null);
    await expect(createStoreAction({}, fd({ name: "x", templateKey: "coffee" }))).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(updateStoreAction({}, fd({ storeId: bId, name: "x" }))).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(deleteStoreAction({}, fd({ storeId: bId, confirmName: "B shop" }))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(await prisma.store.count()).toBe(2);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: bId } })).name).toBe("B shop");
  });
});

describe("Server Actions: forged requests from User A against User B's store", () => {
  it("update with B's storeId (plus forged ownerId/userId/status fields) -> 404, B unchanged", async () => {
    const { a, b, bId } = await setup();
    loginAs(a.id);
    const before = JSON.stringify(await prisma.store.findUnique({ where: { id: bId } }));
    await expect(
      updateStoreAction({}, fd({ storeId: bId, ownerId: a.id, userId: a.id, status: "PUBLISHED", name: "pwned", primaryColor: "#ff0000" })),
    ).rejects.toThrow(`NEXT_REDIRECT:/dashboard/stores/${bId}`);
    expect(JSON.stringify(await prisma.store.findUnique({ where: { id: bId } }))).toBe(before);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: bId } })).ownerId).toBe(b.id);
  });

  it("delete with B's storeId and B's exact name -> 404, B's store and pages survive", async () => {
    const { a, bId } = await setup();
    loginAs(a.id);
    await expect(deleteStoreAction({}, fd({ storeId: bId, confirmName: "B shop", ownerId: a.id }))).rejects.toThrow(`NEXT_REDIRECT:/dashboard/stores/${bId}`);
    expect(await prisma.store.count({ where: { id: bId } })).toBe(1);
    expect(await prisma.page.count({ where: { storeId: bId } })).toBe(5);
  });

  it("a foreign id and a random id produce the identical outcome", async () => {
    const { a, bId } = await setup();
    loginAs(a.id);
    const outcome = async (storeId: string) =>
      updateStoreAction({}, fd({ storeId, name: "x", primaryColor: "#123456", phone: "", email: "", address: "", instagram: "", telegram: "", whatsapp: "" })).then(
        () => "resolved",
        (e: Error) => e.message.replace(storeId, "<id>"),
      );
    // identical shape for a foreign id and a random id: a redirect to that store's (404) URL
    expect(await outcome(bId)).toBe(await outcome("random-nonexistent-id"));
    expect(await outcome(bId)).toBe("NEXT_REDIRECT:/dashboard/stores/<id>");
  });

  it("create ignores a forged ownerId/templateVersionId and always uses the session user", async () => {
    const { a, b } = await setup();
    loginAs(a.id);
    await expect(
      createStoreAction({}, fd({ name: "mine", templateKey: "fashion", ownerId: b.id, templateVersionId: "x" })),
    ).rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/stores\//);
    const s = await prisma.store.findFirstOrThrow({ where: { name: "mine" } });
    expect(s.ownerId).toBe(a.id);
  });
});

describe("Server Actions: owner flows", () => {
  it("update saves and reports success; invalid input returns field errors without saving", async () => {
    const { a, aId } = await setup();
    loginAs(a.id);
    const ok = await updateStoreAction({}, fd({ storeId: aId, name: "Renamed", primaryColor: "#123456", phone: "09120000000", email: "", address: "x", instagram: "a_b", telegram: "", whatsapp: "" }));
    expect(ok.success).toBeTruthy();
    expect((await prisma.store.findUniqueOrThrow({ where: { id: aId } })).name).toBe("Renamed");
    const bad = await updateStoreAction({}, fd({ storeId: aId, name: "", primaryColor: "red", phone: "", email: "", address: "", instagram: "", telegram: "", whatsapp: "" }));
    expect(bad.error).toBeTruthy();
    expect(bad.fieldErrors?.name).toBeTruthy();
    expect((await prisma.store.findUniqueOrThrow({ where: { id: aId } })).name).toBe("Renamed");
  });
  it("delete requires the typed name, then deletes and redirects", async () => {
    const { a, aId } = await setup();
    loginAs(a.id);
    const wrong = await deleteStoreAction({}, fd({ storeId: aId, confirmName: "wrong" }));
    expect(wrong.fieldErrors?.confirmName).toBeTruthy();
    expect(await prisma.store.count({ where: { id: aId } })).toBe(1);
    await expect(deleteStoreAction({}, fd({ storeId: aId, confirmName: "A shop" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(await prisma.store.count({ where: { id: aId } })).toBe(0);
  });
  it("create reports the store limit as a form error", async () => {
    const { a } = await setup();
    loginAs(a.id);
    for (let i = 0; i < 9; i++) await createStore(a.id, { name: `s${i}`, templateKey: "general" });
    const r = await createStoreAction({}, fd({ name: "eleventh", templateKey: "general" }));
    expect(r.error).toContain("۱۰");
  });
});
