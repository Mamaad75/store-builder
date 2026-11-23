import { describe, expect, it } from "vitest";
import { revokeRefusal } from "./platform.js";

describe("platform admin rules (phase 3.1)", () => {
  it("never revokes oneself or the last super admin", () => {
    expect(revokeRefusal("a", "a", 3)).toBe("self");
    expect(revokeRefusal("a", "b", 1)).toBe("last_admin");
    expect(revokeRefusal("a", "b", 2)).toBeNull();
  });
});

describe("platform secrets (phase 3.1)", () => {
  it("binds each envelope to its name and shows a hint only for long values", async () => {
    const { platformSecretContext, secretHint } = await import("./platform.js");
    expect(platformSecretContext("ai.api_key")).toBe("platform|name:ai.api_key");
    expect(platformSecretContext("ai.api_key")).not.toBe(platformSecretContext("sms.kavenegar.api_key"));
    expect(secretHint("short-key")).toBeNull();
    expect(secretHint("x".repeat(20) + "ABCD")).toBe("ABCD");
  });
});
