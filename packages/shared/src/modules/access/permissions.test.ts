import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, can } from "./permissions.js";

describe("store roles (D23-1)", () => {
  it("the owner can do everything", () => {
    for (const p of PERMISSIONS) expect(can("OWNER", p), p).toBe(true);
  });

  it("a manager can do everything except deleting the store and managing staff", () => {
    expect(PERMISSIONS.filter((p) => !can("MANAGER", p))).toEqual(["store.delete", "members.manage"]);
  });

  it("an operator works on catalog, media and pages only (no publishing, settings, theme, domain, staff or audit)", () => {
    expect(PERMISSIONS.filter((p) => can("OPERATOR", p))).toEqual(["store.view", "catalog.write", "media.write", "pages.write"]);
  });

  it("only staff roles can be granted (the owner is never a member or an invitee)", () => {
    expect(STAFF_ROLES).toEqual(["MANAGER", "OPERATOR"]);
  });

  it("every role table entry is a known permission (no typos can grant nothing or everything)", () => {
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) expect(PERMISSIONS).toContain(p);
  });
});
