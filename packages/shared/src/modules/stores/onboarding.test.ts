import { describe, expect, it } from "vitest";
import { buildOnboarding, type OnboardingFacts } from "./onboarding.js";

const f = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => ({ id: "s1", name: "فروشگاه", status: "DRAFT", categories: 0, products: 0, hasSubdomain: false, ...over });
const done = (o: ReturnType<typeof buildOnboarding>) => o!.steps.filter((s) => s.done).map((s) => s.key);

describe("onboarding checklist (derived, never stored)", () => {
  it("a new account sees only 'create a store', pointing at the store form", () => {
    const o = buildOnboarding([])!;
    expect(done(o)).toEqual([]);
    expect(o.storeName).toBeNull();
    expect(o.steps[0]).toMatchObject({ key: "store", href: "/dashboard/stores/new" });
  });
  it("follows the newest unpublished store and ticks what exists", () => {
    expect(done(buildOnboarding([f()]))).toEqual(["store"]);
    expect(done(buildOnboarding([f({ categories: 1 })]))).toEqual(["store", "category"]);
    expect(done(buildOnboarding([f({ categories: 1, products: 2, hasSubdomain: true })]))).toEqual(["store", "category", "product", "subdomain"]);
  });
  it("links every step into the focused store, owner-scoped paths only", () => {
    const o = buildOnboarding([f({ id: "abc" })])!;
    for (const s of o.steps.slice(1)) expect(s.href).toMatch(/^\/dashboard\/stores\/abc(\/|$)/);
    expect(o.doneCount).toBe(1);
  });
  it("skips already published stores when choosing the focus (newest first)", () => {
    const o = buildOnboarding([f({ id: "pub", status: "PUBLISHED" }), f({ id: "draft", name: "دوم" })])!;
    expect(o.storeName).toBe("دوم");
    expect(o.steps[1]!.href).toContain("/stores/draft/");
  });
  it("disappears once every store is published, and an unpublished store brings it back", () => {
    expect(buildOnboarding([f({ status: "PUBLISHED" })])).toBeNull();
    expect(buildOnboarding([f({ status: "UNPUBLISHED" })])).not.toBeNull();
  });
});
