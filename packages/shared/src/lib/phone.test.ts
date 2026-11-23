import { describe, expect, it } from "vitest";
import { formatIranMobile, maskPhone, normalizeIranMobile } from "./phone.js";

describe("Iranian mobile numbers (phase 3.1)", () => {
  it("accepts the usual ways of writing one and stores E.164", () => {
    for (const raw of ["09123456789", "9123456789", "+989123456789", "00989123456789", "989123456789", "۰۹۱۲۳۴۵۶۷۸۹", "٠٩١٢٣٤٥٦٧٨٩", "0912 345 6789", "0912-345-6789", " (0912) 3456789 "])
      expect(normalizeIranMobile(raw), raw).toBe("+989123456789");
  });
  it("refuses landlines, short or long numbers, other countries, letters and non-strings", () => {
    for (const raw of ["02112345678", "0912345678", "091234567890", "+15551234567", "0912abc6789", "", "09123456789\n1", "x".repeat(50), 9123456789, null])
      expect(normalizeIranMobile(raw as never), String(raw)).toBeNull();
  });
  it("formats for display and masks for logs", () => {
    expect(formatIranMobile("+989123456789")).toBe("0912 345 6789");
    expect(maskPhone("+989123456789")).toBe("+98•••••••6789");
  });
});
