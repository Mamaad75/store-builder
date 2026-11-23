import { domainErrorMessage } from "@store-builder/shared/errors/registry";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@store-builder/shared/modules/orders/orders";

export const STATUS_COLOR: Record<OrderStatus, "default" | "info" | "warning" | "success" | "error"> = {
  PLACED: "warning",
  CONFIRMED: "info",
  SHIPPED: "info",
  DELIVERED: "success",
  CANCELLED: "default",
};
export { ORDER_STATUS_LABELS };
/** The merchant's button text for moving an order to a status. */
export const ACTION_LABEL: Record<OrderStatus, string> = {
  PLACED: "ثبت",
  CONFIRMED: "تأیید سفارش",
  SHIPPED: "ثبت ارسال",
  DELIVERED: "ثبت تحویل",
  CANCELLED: "لغو سفارش",
};
export const toman = (n: number) => `${n.toLocaleString("fa-IR")} تومان`;
export const date = (iso: string) => new Date(iso).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });

/** A Persian sentence for a failed dashboard call. */
export function failText(e: unknown): string {
  if (e instanceof Error && e.name === "PermissionDeniedError") return "این بخش فقط برای مالک و مدیر فروشگاه است.";
  if (e instanceof Error && e.name === "ValidationError") {
    const fe = (e as Error & { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {};
    return Object.values(fe).flat()[0] ?? "اطلاعات واردشده را بررسی کنید.";
  }
  const known = e instanceof Error ? domainErrorMessage(e.name) : null;
  if (known) return known;
  if (e instanceof Error && /[؀-ۿ]/.test(e.message)) return e.message;
  return "ارتباط با سرور برقرار نشد؛ دوباره تلاش کنید.";
}
