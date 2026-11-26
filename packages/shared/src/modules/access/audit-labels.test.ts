import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_GROUPS, auditActionGroup, auditActionLabel, auditDetails } from "./audit-labels";

describe("audit labels", () => {
  it("every action has a Persian sentence and a known group", () => {
    for (const [action, v] of Object.entries(AUDIT_ACTIONS)) {
      expect(v.label, action).toMatch(/[؀-ۿ]/);
      expect(AUDIT_GROUPS, action).toContain(v.group);
    }
  });
  it("an unknown action shows as its code, not as nothing", () => {
    expect(auditActionLabel("future.thing")).toBe("future.thing");
    expect(auditActionGroup("future.thing")).toBeNull();
    expect(auditActionLabel("staff.invited")).toBe("همکار دعوت شد");
  });
});

describe("auditDetails", () => {
  it("shows only short plain values of a few known keys; roles in Persian", () => {
    expect(auditDetails({ role: "MANAGER", from: "DRAFT", to: "ACTIVE", cardNumber: "6037997000000001", before: [{ pan: "x" }] })).toEqual(["مدیر", "DRAFT", "ACTIVE"]);
  });
  it("ignores anything that is not a plain object, and long or empty values", () => {
    for (const m of [null, undefined, "x", 5, [], [{ role: "OWNER" }]]) expect(auditDetails(m)).toEqual([]);
    expect(auditDetails({ name: "x".repeat(61), label: "" })).toEqual([]);
  });
});
