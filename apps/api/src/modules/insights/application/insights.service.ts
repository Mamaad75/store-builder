import { TEHRAN_OFFSET_MINUTES } from "@store-builder/shared/modules/orders/overview";
import { dayKeys } from "@store-builder/shared/modules/analytics/analytics";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { PLATFORM_AUDIT_ACTIONS, accountListQuerySchema, buildDashboardSeries, platformActivityQuerySchema } from "@store-builder/shared/modules/platform/insights";
import { EXPIRING_SOON_DAYS, dashboardRange } from "../domain/insights.js";
import type { InsightsRepository } from "./ports.js";

const ID_RE = /^[a-z0-9]{1,64}$/;
const known = (id: string) => {
  if (!ID_RE.test(id)) throw new NotFoundError();
  return id;
};
function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, q: unknown): T {
  const r = schema.safeParse(q ?? {});
  if (r.success) return r.data;
  const out: Record<string, string[]> = {};
  for (const i of r.error.issues) (out[String(i.path[0] ?? "form")] ??= []).push("مقدار نامعتبر است");
  throw new ValidationError(out);
}
function when(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ValidationError({ before: ["تاریخ نامعتبر است"] });
  return d;
}

/** Read-only views for the platform's super admins: the dashboard, accounts, one store in detail, and the platform's own activity log. */
export class InsightsService {
  constructor(
    private readonly repo: InsightsRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async dashboard(daysRaw: unknown) {
    const days = dashboardRange(daysRaw);
    if (!days) throw new ValidationError({ days: ["بازهٔ نمودار باید ۷، ۳۰ یا ۹۰ روز باشد"] });
    const now = this.clock();
    const keys = dayKeys(now, days * 2);
    const offset = TEHRAN_OFFSET_MINUTES * 60_000;
    const from = new Date(Date.parse(`${keys[0]}T00:00:00Z`) - offset);
    const to = new Date(Date.parse(`${keys[keys.length - 1]}T00:00:00Z`) + 86_400_000 - offset); // the end of today (Tehran), exclusive
    const [rows, figures] = await Promise.all([this.repo.dailyRows(from, to), this.repo.figures(now, new Date(now.getTime() + EXPIRING_SOON_DAYS * 86_400_000))]);
    return { ...buildDashboardSeries(now, days, rows), figures };
  }

  async accounts(query: unknown) {
    const q = parse(accountListQuerySchema, query);
    return this.repo.accounts({ q: q.q?.trim() || undefined, before: when(q.before), limit: q.limit ?? 50 });
  }

  async account(id: string) {
    const a = await this.repo.account(known(id));
    if (!a) throw new NotFoundError();
    return a;
  }

  async store(id: string) {
    const s = await this.repo.store(known(id), this.clock());
    if (!s) throw new NotFoundError();
    return s;
  }

  async activity(query: unknown) {
    const q = parse(platformActivityQuerySchema, query);
    const actions = q.group ? Object.entries(PLATFORM_AUDIT_ACTIONS).filter(([, v]) => v.group === q.group).map(([k]) => k) : undefined;
    return this.repo.activity({ actions, before: when(q.before), limit: q.limit ?? 50 });
  }
}
