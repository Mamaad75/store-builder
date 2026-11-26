import { describe, expect, it } from "vitest";
import { orderListQuerySchema, parseOrderSearch } from "./orders.js";

describe("parseOrderSearch", () => {
  it("an order number, with or without #, Persian digits accepted", () => {
    expect(parseOrderSearch("128")).toEqual({ number: 128 });
    expect(parseOrderSearch("#۱۲۸")).toEqual({ number: 128 });
    expect(parseOrderSearch(" ١٢ ")).toEqual({ number: 12 });
  });
  it("from 4 digits a number is also part of a mobile number; a typed leading 0 or 98 is dropped (stored as +989…)", () => {
    expect(parseOrderSearch("0912")).toEqual({ number: 912, phone: "912" });
    expect(parseOrderSearch("09121234567")).toEqual({ phone: "9121234567" }); // 11 digits: too long to be an order number
    expect(parseOrderSearch("+98 912-123")).toEqual(parseOrderSearch("98912123"));
    expect(parseOrderSearch("98912123")).toEqual({ number: 98_912_123, phone: "912123" });
  });
  it("text is part of the recipient's name; Persian letters are normalised", () => {
    expect(parseOrderSearch("  مریم   احمدی ")).toEqual({ name: "مریم احمدی" });
    expect(parseOrderSearch("علي")).toEqual({ name: "علی" }); // Arabic ya becomes Persian ya
    expect(parseOrderSearch("#علی")).toEqual({ name: "علی" });
  });
  it("an empty box searches nothing; a very long digit string is a phone fragment only", () => {
    for (const e of [undefined, "", "   ", "#"]) expect(parseOrderSearch(e)).toBeNull();
    expect(parseOrderSearch("0000")).toEqual({ number: 0, phone: "000" }); // harmless: no order 0, and phones containing 000 match
    expect(parseOrderSearch("00000000000")).toEqual({ phone: "0000000000" });
  });
  it("the list query accepts q and bounds its length", () => {
    expect(orderListQuerySchema.parse({ q: "  ۱۲۸ " }).q).toBe("۱۲۸");
    expect(orderListQuerySchema.safeParse({ q: "x".repeat(61) }).success).toBe(false);
  });
});
