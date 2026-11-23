"use client";

import { useEffect, useState } from "react";
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "@store-builder/shared/modules/orders/orders";
import { provinceName } from "@store-builder/shared/modules/checkout/provinces";
import { cancelOrder, getOrder, problemText, type ShopperOrder } from "@/client/shop";
import { faNumber, toman } from "./format";
import s from "./shop.module.css";

const date = (iso: string) => new Date(iso).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });

/** The shopper's order page (phase 3.4), reached with the order link. Cancelling is possible until the store confirms the order. */
export default function OrderTracker({ token }: { token: string }) {
  const [data, setData] = useState<ShopperOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getOrder(token).then(setData).catch((e) => setError(problemText(e)));
  }, [token]);

  async function cancel() {
    if (!window.confirm("سفارش لغو شود؟")) return;
    setBusy(true);
    setError(null);
    try {
      setData(await cancelOrder(token));
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className={s.page}>{error ? <p className={s.alert} role="alert">{error}</p> : <p className={s.muted}>در حال بارگذاری…</p>}</div>;
  const o = data.order;
  return (
    <div className={s.page}>
      <h1 className={s.title}>سفارش شماره‌ی <span className={s.num}>{faNumber(o.number)}</span></h1>
      {o.history.length === 1 && o.status === "PLACED" && <p className={s.ok}>سفارش شما ثبت شد. این صفحه را نگه دارید؛ پیگیری سفارش با همین نشانی ممکن است.</p>}
      {error && <p className={s.alert} role="alert">{error}</p>}
      <div className={s.card}>
        <p>وضعیت: <span className={s.status}>{ORDER_STATUS_LABELS[o.status]}</span></p>
        <p className={s.muted}>ثبت در {date(o.createdAt)} — {PAYMENT_METHOD_LABELS[o.paymentMethod]}</p>
      </div>
      <section className={s.card} aria-labelledby="ord-items">
        <h2 id="ord-items" className={s.lineName}>کالاها</h2>
        <ul className={s.lines}>
          {o.items.map((i, n) => (
            <li key={n} className={s.line}>
              <div>
                <p className={s.lineName}>{i.name} <span className={s.num}>× {faNumber(i.quantity)}</span></p>
                {i.variantLabel && <p className={s.lineMeta}>{i.variantLabel}</p>}
              </div>
              <span className={s.num}>{toman(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className={s.totals}>
          <div className={s.totalRow}><span>جمع کالاها</span><span className={s.num}>{toman(o.subtotal)}</span></div>
          <div className={s.totalRow}><span>ارسال ({o.shipping.name})</span><span className={s.num}>{o.shipping.cost === 0 ? "رایگان" : toman(o.shipping.cost)}</span></div>
          {o.codFee > 0 && <div className={s.totalRow}><span>کارمزد پرداخت در محل</span><span className={s.num}>{toman(o.codFee)}</span></div>}
          <div className={`${s.totalRow} ${s.grand}`}><span>مبلغ کل</span><span className={s.num}>{toman(o.total)}</span></div>
        </div>
      </section>
      <section className={s.card} aria-labelledby="ord-addr">
        <h2 id="ord-addr" className={s.lineName}>تحویل به</h2>
        <p className={s.muted}>{o.address.recipientName} — {provinceName(o.address.province) ?? o.address.province}، {o.address.city}، {o.address.line} — کد پستی {o.address.postalCode}</p>
        {o.note && <p className={s.muted}>یادداشت: {o.note}</p>}
      </section>
      <section className={s.card} aria-labelledby="ord-hist">
        <h2 id="ord-hist" className={s.lineName}>تاریخچه</h2>
        <ul className={s.history}>
          {o.history.map((h, n) => <li key={n}>{date(h.at)} — {ORDER_STATUS_LABELS[h.to]}{h.note ? ` (${h.note})` : ""}</li>)}
        </ul>
      </section>
      {data.canCancel && <div className={s.actions}><button type="button" className={`${s.button} ${s.ghost}`} onClick={cancel} disabled={busy}>لغو سفارش</button></div>}
    </div>
  );
}
