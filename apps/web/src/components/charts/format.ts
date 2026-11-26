const JALALI_DAY = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { month: "long", day: "numeric", timeZone: "UTC" });
const JALALI_FULL = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** "۵ آذر" for a `YYYY-MM-DD` Tehran day key. */
export const dayLabel = (day: string): string => JALALI_DAY.format(new Date(`${day}T12:00:00Z`));
/** "۵ آذر ۱۴۰۵". */
export const fullDayLabel = (day: string): string => JALALI_FULL.format(new Date(`${day}T12:00:00Z`));

export const fa = (n: number): string => n.toLocaleString("fa-IR");
/** Large numbers shortened for axis ticks: ۱٫۲ میلیون، ۴۵ هزار. */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${fa(Math.round(n / 100_000) / 10)} میلیون`;
  if (n >= 10_000) return `${fa(Math.round(n / 1000))} هزار`;
  return fa(n);
}
