import { describe, expect, it } from "vitest";
import { dashboardRange, escapeLike } from "./insights.js";

describe("insights domain", () => {
  it("accepts 7, 30 and 90 days, defaults to 30, refuses the rest", () => {
    expect(dashboardRange(undefined)).toBe(30);
    expect(dashboardRange("")).toBe(30);
    expect(dashboardRange("7")).toBe(7);
    expect(dashboardRange("90")).toBe(90);
    expect(dashboardRange("14")).toBeNull();
    expect(dashboardRange("abc")).toBeNull();
  });
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});
