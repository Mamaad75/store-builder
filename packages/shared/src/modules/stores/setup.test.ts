import { describe, expect, it } from "vitest";
import { buildSetupChecklist, SETUP_ITEM_TEXT, SETUP_KEYS, type SetupFacts } from "./setup.js";

const none: SetupFacts = { activeProducts: 0, enabledShipping: 0, codShipping: 0, hasBankCards: false, onlineGateways: 0, hasSubdomain: false, published: false };
const done = (f: Partial<SetupFacts>) => Object.fromEntries(buildSetupChecklist({ ...none, ...f }).items.map((i) => [i.key, i.done]));

describe("buildSetupChecklist", () => {
  it("an empty store has nothing done, in a fixed order, and every item has text and a page", () => {
    const c = buildSetupChecklist(none);
    expect(c.items.map((i) => i.key)).toEqual([...SETUP_KEYS]);
    expect(c.items.every((i) => !i.done)).toBe(true);
    expect(c.complete).toBe(false);
    expect(c.paymentMethods).toEqual([]);
    for (const k of SETUP_KEYS) expect(SETUP_ITEM_TEXT[k].path.startsWith("/")).toBe(true);
  });

  it("each fact completes only its own item", () => {
    expect(done({ activeProducts: 1 })).toMatchObject({ product: true, shipping: false, payment: false, subdomain: false, publish: false });
    expect(done({ enabledShipping: 1 })).toMatchObject({ product: false, shipping: true, payment: false });
    expect(done({ hasSubdomain: true })).toMatchObject({ subdomain: true, publish: false });
    expect(done({ published: true })).toMatchObject({ publish: true, subdomain: false });
  });

  it("payment: cash on delivery, an online gateway or a bank card each count; a shipping method without COD does not", () => {
    expect(done({ enabledShipping: 1 }).payment).toBe(false);
    expect(buildSetupChecklist({ ...none, enabledShipping: 1, codShipping: 1 }).paymentMethods).toEqual(["cod"]);
    expect(buildSetupChecklist({ ...none, onlineGateways: 1 }).paymentMethods).toEqual(["online"]);
    expect(buildSetupChecklist({ ...none, hasBankCards: true }).paymentMethods).toEqual(["cardTransfer"]);
    expect(buildSetupChecklist({ ...none, codShipping: 2, onlineGateways: 2, hasBankCards: true }).paymentMethods).toEqual(["cod", "online", "cardTransfer"]);
  });

  it("complete only when all five are done", () => {
    const all: SetupFacts = { activeProducts: 3, enabledShipping: 1, codShipping: 1, hasBankCards: false, onlineGateways: 0, hasSubdomain: true, published: true };
    expect(buildSetupChecklist(all).complete).toBe(true);
    for (const off of [{ activeProducts: 0 }, { enabledShipping: 0, codShipping: 0 }, { codShipping: 0 }, { hasSubdomain: false }, { published: false }]) {
      expect(buildSetupChecklist({ ...all, ...off }).complete).toBe(false);
    }
  });
});
