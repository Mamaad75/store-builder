import { describe, expect, it } from "vitest";
import { MAX_PENDING_PER_CUSTOMER } from "@store-builder/shared/modules/reviews/reviews";
import { ANONYMOUS_AUTHOR, authorNameFor, canQueueAnother } from "./review.js";

describe("review rules", () => {
  it("shows the customer's name, trimmed and cut, or a neutral word; never anything else", () => {
    expect(authorNameFor("  علی   رضایی ")).toBe("علی رضایی");
    expect(authorNameFor("x".repeat(100))).toHaveLength(60);
    expect(authorNameFor(null)).toBe(ANONYMOUS_AUTHOR);
    expect(authorNameFor("   ")).toBe(ANONYMOUS_AUTHOR);
  });
  it("limits the reviews one customer can have waiting", () => {
    expect(canQueueAnother(MAX_PENDING_PER_CUSTOMER - 1)).toBe(true);
    expect(canQueueAnother(MAX_PENDING_PER_CUSTOMER)).toBe(false);
  });
});
