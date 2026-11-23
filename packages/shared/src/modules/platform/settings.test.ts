import { describe, expect, it } from "vitest";
import { aiSettingsSchema, isObviouslyInternal, smsSettingsSchema } from "./settings.js";

describe("platform settings schemas (phase 3.1)", () => {
  it("security review 2026-11-23: the AI address must be public https (internal hosts refused at save time)", () => {
    const ok = (baseUrl: string) => aiSettingsSchema.safeParse({ enabled: true, provider: "openai_compatible", baseUrl, model: "gpt" }).success;
    expect(ok("")).toBe(true);
    expect(ok("https://api.example-ai.ir/v1")).toBe(true);
    for (const bad of ["http://api.example.ir", "https://localhost/v1", "https://api", "https://10.0.0.5", "https://192.168.1.2", "https://172.20.0.1", "https://127.0.0.1", "https://169.254.169.254", "https://[::1]", "https://[fd00::1]", "https://svc.internal", "https://u:p@api.example.ir", "https://api.example.ir/?k=1"])
      expect(ok(bad), bad).toBe(false);
  });
  it("internal host detection", () => {
    for (const h of ["localhost", "worker", "db.local", "10.1.1.1", "100.64.0.1", "fe80::1"]) expect(isObviouslyInternal(h), h).toBe(true);
    for (const h of ["api.openai.com", "8.8.8.8", "172.32.0.1"]) expect(isObviouslyInternal(h), h).toBe(false);
  });
  it("the SMS template accepts only safe names and the group is strict", () => {
    expect(smsSettingsSchema.safeParse({ provider: "kavenegar", customerOtpEnabled: false, otpTemplate: "verify-code" }).success).toBe(true);
    expect(smsSettingsSchema.safeParse({ provider: "kavenegar", customerOtpEnabled: false, otpTemplate: "x y" }).success).toBe(false);
    expect(smsSettingsSchema.safeParse({ provider: "kavenegar", customerOtpEnabled: false, otpTemplate: "", extra: 1 }).success).toBe(false);
  });
});
