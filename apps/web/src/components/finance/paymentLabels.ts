import type { PlatformPaymentDto } from "@/client/api";

export const PAYMENT_STATUS_LABELS: Record<PlatformPaymentDto["status"], string> = {
  CREATED: "در انتظار پرداخت",
  PAID: "پرداخت شد",
  FAILED: "ناموفق",
  EXPIRED: "منقضی شد",
  LATE_CREDITED: "دیرهنگام؛ به کیف پول رفت",
};
export const PAYMENT_STATUS_COLORS: Record<PlatformPaymentDto["status"], "default" | "success" | "warning"> = { CREATED: "warning", PAID: "success", FAILED: "default", EXPIRED: "default", LATE_CREDITED: "success" };
export const paymentTitle = (p: PlatformPaymentDto) => (p.purpose === "TOPUP" ? "شارژ کیف پول" : `اشتراک ${p.planName ?? ""}`.trim());
