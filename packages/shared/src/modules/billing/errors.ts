/** The store's plan does not allow adding more of something (HTTP 409). `limit` is what applies now; `free` = no running subscription. */
export class PlanLimitError extends Error {
  constructor(
    public readonly kind: "product" | "staff",
    public readonly limit: number,
    public readonly free: boolean,
  ) {
    super(`plan limit reached (${kind}: ${limit})`);
    this.name = "PlanLimitError";
  }
}
const WHAT = { product: "محصول", staff: "همکار" } as const;
/** The sentence shown to the owner. */
export function planLimitMessage(e: { kind: "product" | "staff"; limit: number; free: boolean }): string {
  const n = e.limit.toLocaleString("fa-IR");
  return e.free
    ? `بدون اشتراک فعال حداکثر ${n} ${WHAT[e.kind]} مجاز است. برای افزایش سقف، از «اشتراک‌ها» یک پلن بخرید.`
    : `پلن شما حداکثر ${n} ${WHAT[e.kind]} را مجاز می‌کند. برای افزایش سقف، از «اشتراک‌ها» پلن بزرگ‌تری بخرید.`;
}
