import { z } from "zod";
import { decideRate, isStale, RATE_CODES, RATE_SANITY, type RateCode } from "@store-builder/shared/modules/pricing/pricing";
import { ConflictError, NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { CurrentRates } from "../domain/pricing.js";
import type { RateRow, RateStore, RatesConfig, Repricer, RepriceReport } from "./ports.js";

const manualSchema = z.object({ code: z.enum(RATE_CODES), rateToman: z.number().int() }).strict();
const ID_RE = /^[a-z0-9]{1,64}$/;

export interface RatesOverview {
  provider: "off" | "manual" | "navasan";
  current: Record<RateCode, { rateToman: number; appliedAt: Date; stale: boolean } | null>;
  pending: RateRow[];
  history: RateRow[];
}

/** What one run of the hourly job did; `attention` = something a person must look at (exit code 2 of the job, which raises the alert). */
export interface RefreshReport {
  fetched: RateCode[];
  applied: RateCode[];
  held: RateCode[];
  rejected: RateCode[];
  stale: RateCode[];
  failed: boolean;
  repriced: RepriceReport | null;
  attention: boolean;
}

/**
 * Rates (phase 3.2b, D32b-1): the super admin's view and decisions, and the hourly refresh. Automatic readings are applied only when they
 * are plausible and close to the last applied rate; the very first one and every big jump wait for a person (owner decision: hold the
 * price and alert). Every applied rate reprices all links.
 */
export class RatesService {
  constructor(
    private readonly store: RateStore,
    private readonly config: RatesConfig,
    private readonly repricer: Repricer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async overview(): Promise<RatesOverview> {
    const [settings, current, pending, history] = await Promise.all([this.config.settings(), this.store.current(), this.store.pending(), this.store.history(30)]);
    const now = this.clock();
    const cur = Object.fromEntries(
      RATE_CODES.map((c) => {
        const r = current[c];
        return [c, r ? { ...r, stale: isStale(r.appliedAt, now, settings.maxAgeHours) } : null];
      }),
    ) as RatesOverview["current"];
    return { provider: settings.provider, current: cur, pending, history };
  }

  /** A super admin types a rate: applied at once (a person decided), still inside the plausibility band. */
  async enterManual(actorId: string, body: unknown): Promise<RateRow> {
    const r = manualSchema.safeParse(body);
    if (!r.success) throw new ValidationError(r.error.flatten().fieldErrors as Record<string, string[]>);
    const band = RATE_SANITY[r.data.code];
    if (r.data.rateToman < band.min || r.data.rateToman > band.max) {
      throw new ValidationError({ rateToman: [`نرخ باید بین ${band.min.toLocaleString("fa-IR")} و ${band.max.toLocaleString("fa-IR")} تومان باشد.`] });
    }
    const now = this.clock();
    const row = await this.store.record({ code: r.data.code, rateToman: r.data.rateToman, source: "manual", observedAt: now, status: "APPLIED", decidedById: actorId, now }, { actorId, action: "platform.rate_entered" });
    await this.reprice();
    return row;
  }

  async decide(actorId: string, id: unknown, to: "APPLIED" | "REJECTED"): Promise<void> {
    if (typeof id !== "string" || !ID_RE.test(id)) throw new NotFoundError();
    const r = await this.store.decide(id, to, actorId, this.clock());
    if (r === "missing") throw new NotFoundError();
    if (r === "not_pending") throw new ConflictError();
    if (to === "APPLIED") await this.reprice();
  }

  /** Every applied rate, now: prices of all links follow. Idempotent (the hourly job runs it every time). */
  async reprice() {
    return this.repricer.repriceAll(this.clock());
  }

  /** The hourly job. Never throws for a provider failure: it is reported (and the prices simply stay). */
  async refresh(): Promise<RefreshReport> {
    const settings = await this.config.settings();
    const report: RefreshReport = { fetched: [], applied: [], held: [], rejected: [], stale: [], failed: false, repriced: null, attention: false };
    if (settings.provider === "off") return report;
    const now = this.clock();
    let current: CurrentRates = await this.store.current();

    const source = await this.config.source(settings);
    if (source) {
      try {
        const readings = await source.fetch();
        for (const code of RATE_CODES) {
          const reading = readings[code];
          if (!reading) continue;
          report.fetched.push(code);
          // A reading the provider itself dates older than the freshness window is not news: ignored.
          if (isStale(reading.observedAt, now, settings.maxAgeHours)) continue;
          // Over plain HTTP the reading can be forged on the way: the jump threshold is halved.
          const jump = settings.allowInsecureHttp ? Math.max(1, Math.floor(settings.jumpPercent / 2)) : settings.jumpPercent;
          const decision = decideRate(code, reading.rateToman, current[code]?.rateToman ?? null, jump, await this.store.dayReference(code, now), await this.store.humanReference(code));
          if (decision === "reject") {
            report.rejected.push(code);
            await this.store.record({ code, rateToman: Math.max(1, Math.min(reading.rateToman, 2_000_000_000)), source: source.name, observedAt: reading.observedAt, status: "REJECTED", decidedById: null, now }, null);
            continue;
          }
          await this.store.record({ code, rateToman: reading.rateToman, source: source.name, observedAt: reading.observedAt, status: decision === "apply" ? "APPLIED" : "PENDING", decidedById: null, now }, null);
          (decision === "apply" ? report.applied : report.held).push(code);
        }
      } catch {
        report.failed = true; // the error itself may carry the request URL (with the key): never logged or returned
      }
      current = await this.store.current();
    }

    for (const code of RATE_CODES) if (isStale(current[code]?.appliedAt ?? null, now, settings.maxAgeHours)) report.stale.push(code);
    report.repriced = await this.repricer.repriceAll(now);
    const pending = await this.store.pending();
    report.attention = report.failed || report.stale.length > 0 || pending.length > 0 || report.rejected.length > 0 || report.repriced.failedStores > 0;
    return report;
  }
}
