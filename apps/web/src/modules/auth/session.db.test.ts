import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb } from "@/test/db-helpers";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

beforeEach(async () => {
  await resetDb();
  authMock.mockReset();
});
afterAll(() => prisma.$disconnect());

describe("unauthorized dashboard access (requireUser)", () => {
  it("redirects to /login when there is no session", async () => {
    const { requireUser } = await import("./session");
    authMock.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
  it("redirects when the session user no longer exists", async () => {
    const { requireUser } = await import("./session");
    authMock.mockResolvedValue({ user: { id: "missing" } });
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
  it("returns only safe user fields for a valid session", async () => {
    const { requireUser } = await import("./session");
    const u = await prisma.user.create({ data: { name: "Ali", username: "ali_test", passwordHash: "x" } });
    authMock.mockResolvedValue({ user: { id: u.id } });
    expect(await requireUser()).toEqual({ id: u.id, username: "ali_test", name: "Ali" });
  });
});
