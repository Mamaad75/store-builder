import { describe, expect, it } from "vitest";
import { hintOf, isSecretName, secretContext } from "./secret.js";

describe("store secret rules", () => {
  it("names are dotted lower-case identifiers of at most 80 characters", () => {
    for (const ok of ["payment.zarinpal.merchant_id", "sms.kavenegar.api_key"]) expect(isSecretName(ok), ok).toBe(true);
    for (const bad of ["Payment.x", "single", "a..b", "a.b-c", `a.${"b".repeat(80)}`, "../etc", ""]) expect(isSecretName(bad), bad).toBe(false);
  });

  it("the hint shows only the last four characters, and nothing for short values", () => {
    expect(hintOf("abcd-1234-efgh-5678-ijkl-9012")).toBe("9012");
    expect(hintOf("x".repeat(23))).toBeNull(); // below 24 characters: no hint at all
    expect(hintOf("x".repeat(24))).toBe("xxxx");
  });

  it("the encryption context names the store and the secret", () => {
    expect(secretContext("s1", "payment.x.key")).toBe("store:s1|name:payment.x.key");
  });
});
