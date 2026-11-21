import { describe, expect, it } from "vitest";
import { invitationExpiry, inviteRefusal, roleOf } from "./access.js";

describe("store access rules", () => {
  it("the owner is OWNER, a member has their staff role, anyone else has no role", () => {
    expect(roleOf({ ownerId: "o", memberRole: null }, "o")).toBe("OWNER");
    expect(roleOf({ ownerId: "o", memberRole: "OPERATOR" }, "m")).toBe("OPERATOR");
    expect(roleOf({ ownerId: "o", memberRole: null }, "x")).toBeNull();
  });

  it("an invitation is valid for 14 days", () => {
    expect(invitationExpiry(new Date("2026-11-01T00:00:00Z")).toISOString()).toBe("2026-11-15T00:00:00.000Z");
  });

  it("only an existing account that is not the inviter, the owner or already staff can be invited", () => {
    const base = { inviterId: "o", ownerId: "o", targetId: "u", targetIsMember: false };
    expect(inviteRefusal(base)).toBeNull();
    expect(inviteRefusal({ ...base, targetId: null })).toBe("unknown_user");
    expect(inviteRefusal({ ...base, targetId: "o" })).toBe("self");
    expect(inviteRefusal({ ...base, inviterId: "m", targetId: "o" })).toBe("owner");
    expect(inviteRefusal({ ...base, targetIsMember: true })).toBe("already_member");
  });
});
