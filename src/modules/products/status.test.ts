import { describe, expect, it } from "vitest";
import { PRODUCT_STATUSES, allowedTransitions, canTransition } from "./status";

describe("product status transitions", () => {
  const matrix: Record<string, boolean> = {
    "DRAFT>DRAFT": false, "DRAFT>ACTIVE": true, "DRAFT>ARCHIVED": true,
    "ACTIVE>DRAFT": true, "ACTIVE>ACTIVE": false, "ACTIVE>ARCHIVED": true,
    "ARCHIVED>DRAFT": true, "ARCHIVED>ACTIVE": false, "ARCHIVED>ARCHIVED": false,
  };
  for (const from of PRODUCT_STATUSES) {
    for (const to of PRODUCT_STATUSES) {
      it(`${from} -> ${to} is ${matrix[`${from}>${to}`] ? "allowed" : "rejected"}`, () => {
        expect(canTransition(from, to)).toBe(matrix[`${from}>${to}`]);
      });
    }
  }
  it("an archived product can only return to DRAFT", () => {
    expect(allowedTransitions("ARCHIVED")).toEqual(["DRAFT"]);
  });
});
