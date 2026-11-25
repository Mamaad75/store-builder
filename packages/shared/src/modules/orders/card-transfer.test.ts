import { describe, expect, it } from "vitest";
import { maskCardNumber, bankCardInputSchema, bankOf, formatCardNumber, luhnValid, receiptFieldsSchema, replaceBankCardsSchema, reviewReceiptSchema } from "./card-transfer.js";

const MELLI = "6037991234567893";
const MELLAT = "6104339876543210";

describe("card-to-card rules (D35b-1)", () => {
  it("Luhn, bank hint and display format", () => {
    expect(luhnValid(MELLI)).toBe(true);
    expect(luhnValid("6037991234567890")).toBe(false);
    expect(luhnValid("603799123456789")).toBe(false);
    expect(bankOf(MELLI)).toBe("بانک ملی ایران");
    expect(bankOf("۶۱۰۴-۳۳۹۸-۷۶۵۴-۳۲۱۰")).toBe("بانک ملت");
    expect(bankOf("1234567812345670")).toBeNull();
    expect(formatCardNumber(MELLI)).toBe("6037-9912-3456-7893");
  });

  it("a bank card: Persian digits, spaces and dashes accepted; bank name filled from the number when empty", () => {
    expect(bankCardInputSchema.parse({ cardNumber: "۶۰۳۷ ۹۹۱۲-۳۴۵۶ ۷۸۹۳", holderName: "  علی  رضایی " })).toEqual({ cardNumber: MELLI, holderName: "علی رضایی", bankName: "بانک ملی ایران" });
    expect(bankCardInputSchema.parse({ cardNumber: MELLAT, holderName: "سارا", bankName: "ملت شعبه‌ی مرکزی" }).bankName).toBe("ملت شعبه‌ی مرکزی");
    for (const bad of [{ cardNumber: "6037991234567890", holderName: "علی" }, { cardNumber: "603799123", holderName: "علی" }, { cardNumber: MELLI, holderName: "" }, { cardNumber: MELLI, holderName: "علی", extra: 1 }]) {
      expect(bankCardInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("at most 5 cards, no duplicates", () => {
    const c = { cardNumber: MELLI, holderName: "علی" };
    expect(replaceBankCardsSchema.safeParse({ cards: [c, { ...c, cardNumber: MELLAT }] }).success).toBe(true);
    expect(replaceBankCardsSchema.safeParse({ cards: [c, c] }).success).toBe(false);
    expect(replaceBankCardsSchema.safeParse({ cards: Array(6).fill(c) }).success).toBe(false);
    expect(replaceBankCardsSchema.safeParse({ cards: [] }).success).toBe(true);
  });

  it("receipt fields and review", () => {
    expect(receiptFieldsSchema.parse({ trackingCode: "۱۲۳ ۴۵۶۷۸", payerCardLast4: "۵۹۹۵" })).toEqual({ trackingCode: "12345678", payerCardLast4: "5995" });
    expect(receiptFieldsSchema.safeParse({ trackingCode: "12", payerCardLast4: "5995" }).success).toBe(false);
    expect(receiptFieldsSchema.safeParse({ trackingCode: "123456", payerCardLast4: "599" }).success).toBe(false);
    expect(reviewReceiptSchema.safeParse({ decision: "approve" }).success).toBe(true);
    expect(reviewReceiptSchema.safeParse({ decision: "reject" }).success).toBe(false);
    expect(reviewReceiptSchema.parse({ decision: "reject", reason: "مبلغ کمتر واریز شده" }).reason).toBe("مبلغ کمتر واریز شده");
  });
});

describe("maskCardNumber (D-22)", () => {
  it("keeps the bank prefix and the last 4 digits only; anything unexpected is fully hidden", () => {
    expect(maskCardNumber("6037991234567893")).toBe("603799******7893");
    expect(maskCardNumber("6037991234567893")).not.toContain("123456");
    expect(maskCardNumber("")).toBe("****");
    expect(maskCardNumber("6037-9912-3456-7893")).toBe("****");
  });
});
