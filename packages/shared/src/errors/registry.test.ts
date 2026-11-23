import { describe, expect, it } from "vitest";
import { DOMAIN_ERRORS, domainErrorMessage, rebuildDomainError } from "./registry.js";

describe("domain error messages on the other side of HTTP", () => {
  it("a rebuilt error carries only its class name; domainErrorMessage gives back the fixed Persian text", () => {
    const e = rebuildDomainError("CustomerLoginError", {});
    expect(e?.name).toBe("CustomerLoginError");
    expect(domainErrorMessage(e!.name)).toBe("شماره‌ی موبایل یا رمز عبور نادرست است.");
    expect(domainErrorMessage("CartLimitError")).toMatch(/سبد خرید پر است/);
    expect(domainErrorMessage("OutOfStockError")).toBe("موجودی کافی نیست.");
  });

  it("unknown names and classes without a Persian message give null", () => {
    expect(domainErrorMessage("Nope")).toBeNull();
    expect(domainErrorMessage("constructor")).toBeNull();
    expect(domainErrorMessage("__proto__")).toBeNull();
  });

  it("every phase 3 shopper-facing error has a Persian message", () => {
    for (const n of ["CartLimitError", "CartRateLimitedError", "AddressLimitError", "OrderNotReadyError", "OrderTransitionError", "OrderRateLimitedError", "CustomerLoginError", "CustomerExistsError", "CustomerLoginRateLimitedError", "OutOfStockError", "ReservationLostError"]) {
      expect(Object.keys(DOMAIN_ERRORS)).toContain(n);
      expect(domainErrorMessage(n), n).toMatch(/[؀-ۿ]/);
    }
  });
});
