import { describe, expect, it } from "vitest";
import { PLATFORM_SETTING_DEFAULTS, type RatesSettings } from "@store-builder/shared/modules/platform/settings";
import { ConflictError, NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { CurrentRates } from "../domain/pricing.js";
import { RatesService } from "./rates.service.js";
import type { RateReadings, RateRow, RateSource, RateStore, Repricer } from "./ports.js";

const NOW = new Date("2026-11-24T10:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

class MemoryRates implements RateStore {
  rows: RateRow[] = [];
  audits: { actorId: string; action: string }[] = [];
  private seq = 0;
  async current(): Promise<CurrentRates> {
    const out: CurrentRates = {};
    for (const r of [...this.rows].filter((x) => x.status === "APPLIED").sort((a, b) => a.decidedAt!.getTime() - b.decidedAt!.getTime())) out[r.code] = { rateToman: r.rateToman, appliedAt: r.decidedAt! };
    return out;
  }
  dayRef: number | null = null;
  dayReference = async () => this.dayRef;
  humanReference = async (code: "USD" | "GOLD18") => [...this.rows].reverse().find((r) => r.code === code && r.status === "APPLIED" && r.decidedById)?.rateToman ?? null;
  pending = async () => this.rows.filter((r) => r.status === "PENDING");
  history = async (n: number) => this.rows.slice(-n);
  async record(r: Parameters<RateStore["record"]>[0], audit: { actorId: string; action: string } | null) {
    if (r.status !== "REJECTED") for (const x of this.rows) if (x.code === r.code && x.status === "PENDING") x.status = "REJECTED";
    const row: RateRow = { id: `r${++this.seq}`, code: r.code, rateToman: r.rateToman, source: r.source, observedAt: r.observedAt, status: r.status, decidedById: r.decidedById, decidedAt: r.status === "PENDING" ? null : r.now, createdAt: r.now };
    this.rows.push(row);
    if (audit) this.audits.push(audit);
    return row;
  }
  async decide(id: string, to: "APPLIED" | "REJECTED", actorId: string, now: Date) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return "missing" as const;
    if (row.status !== "PENDING") return "not_pending" as const;
    Object.assign(row, { status: to, decidedById: actorId, decidedAt: now });
    return "ok" as const;
  }
}

function setup(settings: Partial<RatesSettings>, source: RateSource | null, failedStores = 0) {
  const store = new MemoryRates();
  const reprices: CurrentRates[] = [];
  const repricer: Repricer = { repriceAll: async () => (reprices.push(await store.current()), { stores: 1, priced: 1, outOfRange: 0, failedStores }) };
  const svc = new RatesService(store, { settings: async () => ({ ...PLATFORM_SETTING_DEFAULTS.rates, ...settings }), source: async () => source }, repricer, () => NOW);
  return { store, svc, reprices };
}
const source = (readings: RateReadings | Error): RateSource => ({ name: "navasan", fetch: async () => (readings instanceof Error ? Promise.reject(readings) : readings) });
const seed = (store: MemoryRates, code: "USD" | "GOLD18", rateToman: number, at = hoursAgo(1)) => store.record({ code, rateToman, source: "manual", observedAt: at, status: "APPLIED", decidedById: "admin", now: at }, null);

describe("RatesService.refresh (hourly job)", () => {
  it("off: does nothing at all", async () => {
    const { svc, store, reprices } = setup({ provider: "off" }, source({ USD: { rateToman: 100_000, observedAt: NOW } }));
    expect((await svc.refresh()).attention).toBe(false);
    expect(store.rows).toEqual([]);
    expect(reprices).toEqual([]);
  });

  it("applies a small move and reprices; holds a big jump for a person (prices stay) and asks for attention", async () => {
    const { svc, store, reprices } = setup({ provider: "navasan" }, source({ USD: { rateToman: 103_000, observedAt: NOW }, GOLD18: { rateToman: 9_500_000, observedAt: NOW } }));
    await seed(store, "USD", 100_000);
    await seed(store, "GOLD18", 8_000_000);
    const r = await svc.refresh();
    expect(r).toMatchObject({ applied: ["USD"], held: ["GOLD18"], failed: false, attention: true });
    expect(reprices.at(-1)).toMatchObject({ USD: { rateToman: 103_000 }, GOLD18: { rateToman: 8_000_000 } });
  });

  it("regression (security review 3.2b): slow drift against the rate of a day earlier is held; over HTTP the threshold is halved; a failed store asks for attention", async () => {
    const drift = setup({ provider: "navasan", jumpPercent: 10 }, source({ USD: { rateToman: 79_000, observedAt: NOW } }));
    await seed(drift.store, "USD", 86_800);
    drift.store.dayRef = 100_000;
    expect((await drift.svc.refresh()).held).toEqual(["USD"]);

    const http = setup({ provider: "navasan", jumpPercent: 10, allowInsecureHttp: true }, source({ USD: { rateToman: 107_000, observedAt: NOW } }));
    await seed(http.store, "USD", 100_000);
    expect((await http.svc.refresh()).held).toEqual(["USD"]); // 7% > 5% over HTTP

    const failing = setup({ provider: "manual" }, null, 1);
    await seed(failing.store, "USD", 100_000);
    await seed(failing.store, "GOLD18", 8_000_000);
    expect((await failing.svc.refresh()).attention).toBe(true);
  });

  it("the first automatic rate is held; an implausible one is rejected; an old reading is ignored", async () => {
    const { svc, store } = setup({ provider: "navasan" }, source({ USD: { rateToman: 100_000, observedAt: NOW }, GOLD18: { rateToman: 12, observedAt: NOW } }));
    const r = await svc.refresh();
    expect(r).toMatchObject({ held: ["USD"], rejected: ["GOLD18"], stale: ["USD", "GOLD18"], attention: true });
    expect(store.rows.map((x) => [x.code, x.status])).toEqual([["USD", "PENDING"], ["GOLD18", "REJECTED"]]);

    const old = setup({ provider: "navasan", maxAgeHours: 6 }, source({ USD: { rateToman: 101_000, observedAt: hoursAgo(7) } }));
    await seed(old.store, "USD", 100_000);
    expect((await old.svc.refresh()).applied).toEqual([]);
  });

  it("a provider failure is reported (never thrown, never with its text) and prices stay", async () => {
    const { svc, store } = setup({ provider: "navasan" }, source(new Error("GET http://api.navasan.tech/latest/?api_key=SECRET failed")));
    await seed(store, "USD", 100_000);
    const r = await svc.refresh();
    expect(r.failed).toBe(true);
    expect(r.attention).toBe(true);
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("manual provider: no fetch; staleness alone asks for attention", async () => {
    const { svc, store } = setup({ provider: "manual", maxAgeHours: 6 }, null);
    await seed(store, "USD", 100_000, hoursAgo(1));
    await seed(store, "GOLD18", 8_000_000, hoursAgo(1));
    expect((await svc.refresh()).attention).toBe(false);
    const stale = setup({ provider: "manual", maxAgeHours: 6 }, null);
    await seed(stale.store, "USD", 100_000, hoursAgo(8));
    expect(await stale.svc.refresh()).toMatchObject({ stale: ["USD", "GOLD18"], attention: true });
  });
});

describe("RatesService decisions", () => {
  it("manual entry: validated, inside the plausibility band, audited, applied and repriced", async () => {
    const { svc, store, reprices } = setup({ provider: "manual" }, null);
    await expect(svc.enterManual("admin", { code: "USD", rateToman: 5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.enterManual("admin", { code: "EUR", rateToman: 100_000 })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.enterManual("admin", { code: "USD", rateToman: 100_000, extra: 1 })).rejects.toBeInstanceOf(ValidationError);
    const row = await svc.enterManual("admin", { code: "USD", rateToman: 100_000 });
    expect(row).toMatchObject({ status: "APPLIED", decidedById: "admin", source: "manual" });
    expect(store.audits).toEqual([{ actorId: "admin", action: "platform.rate_entered" }]);
    expect(reprices).toHaveLength(1);
  });
  it("confirm applies (and reprices), reject does not; unknown or decided rows are refused", async () => {
    const { svc, store, reprices } = setup({ provider: "navasan" }, null);
    const p = await store.record({ code: "USD", rateToman: 120_000, source: "navasan", observedAt: NOW, status: "PENDING", decidedById: null, now: NOW }, null);
    await svc.decide("admin", p.id, "APPLIED");
    expect((await store.current()).USD?.rateToman).toBe(120_000);
    expect(reprices).toHaveLength(1);
    await expect(svc.decide("admin", p.id, "REJECTED")).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.decide("admin", "nope", "APPLIED")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.decide("admin", "../x", "APPLIED")).rejects.toBeInstanceOf(NotFoundError);
  });
  it("overview marks old rates as stale", async () => {
    const { svc, store } = setup({ provider: "manual", maxAgeHours: 6 }, null);
    await seed(store, "USD", 100_000, hoursAgo(7));
    const o = await svc.overview();
    expect(o.current.USD).toMatchObject({ rateToman: 100_000, stale: true });
    expect(o.current.GOLD18).toBeNull();
  });
});
