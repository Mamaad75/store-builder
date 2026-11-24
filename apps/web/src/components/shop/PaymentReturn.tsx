"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GATEWAY_REF_RE, type Gateway } from "@store-builder/shared/modules/orders/orders";
import { problemText, verifyPayment } from "@/client/shop";
import s from "./shop.module.css";

type Outcome = "paid" | "pending" | "failed" | "closed" | "refund";
type State = { kind: "loading" } | { kind: "done"; outcome: Outcome; token: string | null } | { kind: "error"; text: string };

const TEXT = {
  paid: "پرداخت شما با موفقیت انجام و سفارش ثبت شد.",
  pending: "پرداخت شما در حال تأیید است. چند دقیقه‌ی دیگر وضعیت سفارش را در صفحه‌ی سفارش ببینید.",
  failed: "پرداخت انجام نشد. اگر مبلغی از حساب شما کم شده باشد، حداکثر ظرف ۷۲ ساعت برمی‌گردد. می‌توانید از صفحه‌ی سفارش دوباره پرداخت کنید.",
  closed: "این سفارش دیگر قابل پرداخت نیست (لغو یا منقضی شده است). اگر مبلغی از حساب شما کم شده باشد، حداکثر ظرف ۷۲ ساعت برمی‌گردد.",
  refund: "مبلغ پرداخت شد، اما این سفارش دیگر فعال نبود. فروشگاه مبلغ را به حساب شما برمی‌گرداند؛ کد پیگیری را نگه دارید و در صورت نیاز با فروشگاه تماس بگیرید.",
} as const;

/** Phase 3.5: the buyer's return from the gateway. The server verifies the payment; this page shows the outcome and links to the order. */
export default function PaymentReturn({ gateway = "ZARINPAL", authority, status }: { gateway?: Gateway; authority: string; status: string }) {
  const router = useRouter();
  const valid = GATEWAY_REF_RE[gateway].test(authority) && (gateway === "ZARINPAL" ? status === "OK" || status === "NOK" : status === "1" || status === "0");
  const [state, setState] = useState<State>(valid ? { kind: "loading" } : { kind: "error", text: "نشانی بازگشت از درگاه نامعتبر است." });

  useEffect(() => {
    if (!valid) return;
    verifyPayment(gateway, authority, status)
      .then((r) => {
        setState({ kind: "done", outcome: r.outcome, token: r.accessToken });
        if (r.outcome === "paid" && r.accessToken) router.replace(`/orders/${encodeURIComponent(r.accessToken)}`);
      })
      .catch((e) => setState({ kind: "error", text: problemText(e) }));
  }, [gateway, authority, status, valid, router]);

  return (
    <div className={s.page}>
      <h1 className={s.title}>نتیجه‌ی پرداخت</h1>
      {state.kind === "loading" && <p className={s.muted} role="status">در حال تأیید پرداخت… لطفاً این صفحه را نبندید.</p>}
      {state.kind === "error" && <p className={s.alert} role="alert">{state.text}</p>}
      {state.kind === "done" && (
        <div className={s.card}>
          <p className={state.outcome === "paid" ? s.ok : s.alert} role="status">{TEXT[state.outcome]}</p>
          {state.token ? (
            <div className={s.actions}><a className={s.button} href={`/orders/${encodeURIComponent(state.token)}`}>مشاهده‌ی سفارش</a></div>
          ) : (
            <p className={s.muted}>جزئیات سفارش را از لینک سفارشی که هنگام خرید دریافت کردید یا از حساب کاربری‌تان ببینید.</p>
          )}
        </div>
      )}
    </div>
  );
}
