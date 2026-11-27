import { z } from "zod";
import { dayKeys, type AnalyticsRange } from "../analytics/analytics.js";
import { TICKET_STATUS_LABELS, type TicketStatus } from "../support/tickets.js";

/**
 * The super admin's dashboard figures and activity log. Pure and shared: the API gathers rows (per Tehran day), these functions shape them,
 * the page only draws the result.
 */

// ---- the dashboard series ----

export const DASH_KEYS = ["newStores", "newUsers", "tickets", "revenue", "purchases"] as const;
export type DashKey = (typeof DASH_KEYS)[number];
export type DayRow = Record<DashKey, number>;
export const EMPTY_DASH_DAY: Readonly<DayRow> = { newStores: 0, newUsers: 0, tickets: 0, revenue: 0, purchases: 0 };

export interface DashboardSeries {
  days: AnalyticsRange;
  from: string;
  to: string;
  series: ({ day: string } & DayRow)[];
  totals: { current: DayRow; previous: DayRow };
}

/** `rows` holds the days with any data (key `YYYY-MM-DD`); the period is the last `days` Tehran days, compared with the `days` before. */
export function buildDashboardSeries(now: Date, days: AnalyticsRange, rows: ReadonlyMap<string, Partial<DayRow>>): DashboardSeries {
  const keys = dayKeys(now, days * 2);
  const sum = (ks: string[]): DayRow => {
    const t: DayRow = { ...EMPTY_DASH_DAY };
    for (const k of ks) for (const f of DASH_KEYS) t[f] += rows.get(k)?.[f] ?? 0;
    return t;
  };
  const current = keys.slice(days);
  return {
    days,
    from: current[0]!,
    to: current[current.length - 1]!,
    series: current.map((day) => ({ day, ...EMPTY_DASH_DAY, ...rows.get(day) })),
    totals: { current: sum(current), previous: sum(keys.slice(0, days)) },
  };
}

// ---- the platform activity log ----

export const PLATFORM_AUDIT_GROUPS = ["accounts", "stores", "money", "support", "settings"] as const;
export type PlatformAuditGroup = (typeof PLATFORM_AUDIT_GROUPS)[number];
export const PLATFORM_AUDIT_GROUP_LABELS: Readonly<Record<PlatformAuditGroup, string>> = { accounts: "حساب‌ها و مدیران", stores: "فروشگاه‌ها", money: "پلن‌ها و مالی", support: "پشتیبانی", settings: "تنظیمات و نرخ‌ها" };

const L = (group: PlatformAuditGroup, label: string) => ({ group, label });
/** Every `platform.*` audit action the API writes (a test fails when one is missing here). */
export const PLATFORM_AUDIT_ACTIONS: Readonly<Record<string, { group: PlatformAuditGroup; label: string }>> = {
  "platform.account_recovered": L("accounts", "بازیابی حساب یک کاربر"),
  "platform.admin_granted": L("accounts", "سوپرادمین تازه اضافه شد"),
  "platform.admin_revoked": L("accounts", "دسترسی یک سوپرادمین برداشته شد"),
  "platform.invite_created": L("accounts", "دعوت‌نامهٔ ثبت‌نام ساخته شد"),
  "platform.invite_revoked": L("accounts", "دعوت‌نامهٔ ثبت‌نام باطل شد"),
  "platform.store_suspended": L("stores", "فروشگاه معلق شد"),
  "platform.store_suspension_amended": L("stores", "پیام تعلیق فروشگاه تغییر کرد"),
  "platform.store_restored": L("stores", "تعلیق فروشگاه برداشته شد"),
  "platform.plan_created": L("money", "پلن اشتراک ساخته شد"),
  "platform.plan_updated": L("money", "پلن اشتراک تغییر کرد"),
  "platform.purchase_recorded": L("money", "خرید اشتراک برای یک فروشگاه ثبت شد"),
  "platform.wallet_adjusted": L("money", "اعتبار کیف پول یک فروشگاه تنظیم شد"),
  "platform.ticket_replied": L("support", "به یک درخواست پشتیبانی پاسخ داده شد"),
  "platform.ticket_status": L("support", "وضعیت یک درخواست پشتیبانی تغییر کرد"),
  "platform.rate_entered": L("settings", "نرخ دستی وارد شد"),
  "platform.rate_confirmed": L("settings", "نرخ دستی تأیید یا رد شد"),
  "platform.secret_set": L("settings", "یک کلید محرمانه ذخیره شد"),
  "platform.secret_deleted": L("settings", "یک کلید محرمانه حذف شد"),
  "platform.settings_updated": L("settings", "تنظیمات پلتفرم تغییر کرد"),
};
export const platformAuditLabel = (action: string): string => PLATFORM_AUDIT_ACTIONS[action]?.label ?? action;
export const platformAuditGroup = (action: string): PlatformAuditGroup | null => PLATFORM_AUDIT_ACTIONS[action]?.group ?? null;

const MONEY_KEYS = new Set(["priceToman", "discountToman", "cashToman", "walletUsedToman", "rewardToman", "amountToman", "balanceAfter"]);
const DETAIL_KEYS: Readonly<Record<string, string>> = {
  name: "نام", priceToman: "قیمت", durationDays: "مدت (روز)", active: "فعال", status: "وضعیت", group: "بخش", discountToman: "تخفیف دعوت", walletUsedToman: "از کیف پول",
  cashToman: "دریافتی", rewardToman: "پاداش دعوت‌کننده", amountToman: "مبلغ", balanceAfter: "موجودی پس از آن",
};
const fa = (n: number) => n.toLocaleString("fa-IR");

/**
 * A few safe facts beside an entry. Only the keys listed here are ever shown, and only numbers, booleans and short plain strings: a free-text
 * reason, a note or anything unexpected in the stored metadata is dropped (never rendered).
 */
export function platformAuditDetails(metadata: unknown): string[] {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return [];
  const m = metadata as Record<string, unknown>;
  const out: string[] = [];
  for (const [key, label] of Object.entries(DETAIL_KEYS)) {
    const v = m[key];
    if (typeof v === "number" && Number.isFinite(v)) out.push(`${label}: ${fa(v)}${MONEY_KEYS.has(key) ? " تومان" : ""}`);
    else if (typeof v === "boolean") out.push(`${label}: ${v ? "بله" : "خیر"}`);
    else if (typeof v === "string" && v.length > 0 && v.length <= 40) out.push(`${label}: ${key === "status" && v in TICKET_STATUS_LABELS ? TICKET_STATUS_LABELS[v as TicketStatus] : v}`);
  }
  return out;
}

export const platformActivityQuerySchema = z.object({
  group: z.enum(PLATFORM_AUDIT_GROUPS).optional(),
  before: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const accountListQuerySchema = z.object({ q: z.string().max(60).optional(), before: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
export const dashboardQuerySchema = z.object({ days: z.string().max(3).optional() });
