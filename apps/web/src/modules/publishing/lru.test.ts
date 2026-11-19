import { describe, expect, it } from "vitest";
import { ByteLru } from "./lru";

describe("ByteLru", () => {
  it("returns what was stored and evicts the least recently used entry when over budget", () => {
    const c = new ByteLru<string>(10);
    c.set("a", "A", 4);
    c.set("b", "B", 4);
    expect(c.get("a")).toBe("A"); // a is now the most recent
    c.set("c", "C", 4); // 12 > 10: evicts b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe("A");
    expect(c.get("c")).toBe("C");
  });
  it("never caches an entry larger than the whole budget (and keeps the others)", () => {
    const c = new ByteLru<string>(10);
    c.set("a", "A", 4);
    c.set("huge", "H", 11);
    expect(c.get("huge")).toBeUndefined();
    expect(c.get("a")).toBe("A");
  });
  it("replacing a key does not double count its cost", () => {
    const c = new ByteLru<string>(10);
    c.set("a", "A1", 9);
    c.set("a", "A2", 9);
    c.set("b", "B", 1);
    expect(c.get("a")).toBe("A2");
    expect(c.get("b")).toBe("B");
  });
  it("shrinking the budget evicts oldest entries first", () => {
    const c = new ByteLru<string>(100);
    c.set("a", "A", 40);
    c.set("b", "B", 40);
    c.setBudget(50);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe("B");
  });
});
