import { describe, expect, it } from "vitest";
import { getAppEnv } from "./env";

describe("getAppEnv", () => {
  it("uses dev defaults", () => {
    expect(getAppEnv({} as NodeJS.ProcessEnv)).toEqual({ APP_ROOT_DOMAIN: "localhost:3000", APP_PROTOCOL: "http" });
  });
  it("reads values and rejects invalid protocol", () => {
    expect(getAppEnv({ APP_ROOT_DOMAIN: "example.com", APP_PROTOCOL: "https" } as unknown as NodeJS.ProcessEnv).APP_ROOT_DOMAIN).toBe("example.com");
    expect(() => getAppEnv({ APP_PROTOCOL: "ftp" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});
