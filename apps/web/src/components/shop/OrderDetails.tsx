"use client";

import { GATEWAY_LABELS, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "@store-builder/shared/modules/orders/orders";
import { provinceName } from "@store-builder/shared/modules/checkout/provinces";
import type { ShopperOrder } from "@/client/shop";
import { faNumber, toman } from "./format";
import CardTransferPanel from "./CardTransferPanel";
import s from "./shop.module.css";

const date = (iso: string) => new Date(iso).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });

/** One order as the shopper sees it (phase 3.4): status, items, totals, delivery, history, and cancel while allowed. */
export default function OrderDetails({
  data,
  error,
  busy,
  cancel,
  pay,
  back,
  receipt,
}: {
  data: ShopperOrder;
  error: string | null;
  busy: boolean;
  cancel: () => void;
  pay?: () => void;
  back?: { href: string; label: string };
  /** D35b-1: sending a card-to-card receipt, and reloading the order afterwards. */
  receipt?: { submit: (image: File, f: { trackingCode: string; payerCardLast4: string }) => Promise<void>; reload: () => void };
}) {
  const o = data.order;
  return (
    <div className={s.page}>
      {back && <a href={back.href}>{back.label}</a>}
      <h1 className={s.title}>سفارش شماره‌ی <span className={s.num}>{faNumber(o.number)}</span></h1>
      {o.history.length === 1 && o.status === "PLACED" && <p className={s.ok}>سفارش شما ثبت شد. این صفحه را نگه دارید؛ پیگیری سفارش با همین نشانی ممکن است.</p>}
      {error && <p className={s.alert} role="alert">{error}</p>}
      {!data.storeOpen && <p className={s.muted}>این فروشگاه در حال حاضر سفارش جدید نمی‌پذیرد؛ پیگیری این سفارش همچنان از همین صفحه ممکن است.</p>}
      <div className={s.card}>
        <p>وضعیت: <span className={s.status}>{ORDER_STATUS_LABELS[o.status]}</span></p>
        <p className={s.muted}>ثبت در {date(o.createdAt)} — {PAYMENT_METHOD_LABELS[o.paymentMethod]}{o.paymentGateway ? ` (${GATEWAY_LABELS[o.paymentGateway]})` : ""}</p>
        {o.payment && <p className={s.muted}>پرداخت‌شده — کد پیگیری <span className={s.num}>{o.payment.refId}</span>{o.payment.cardPan ? <> — کارت <span className={s.num} dir="ltr">{o.payment.cardPan}</span></> : null}</p>}
        {o.paymentMethod === "ONLINE" && o.status === "AWAITING_PAYMENT" && o.paymentDeadline && (
          <p className={data.canPay ? s.alert : s.muted}>
            {data.canPay
              ? `این سفارش هنوز پرداخت نشده است. تا ${date(o.paymentDeadline)} فرصت پرداخت دارید؛ پس از آن سفارش لغو و کالاها آزاد می‌شوند.`
              : new Date(o.paymentDeadline) > new Date()
                ? "این فروشگاه در حال حاضر پرداخت نمی‌پذیرد. اگر سفارش تا پایان مهلت پرداخت نشود، لغو و کالاها آزاد می‌شوند."
                : "مهلت پرداخت این سفارش تمام شده است. اگر مبلغی از حساب شما کم شده باشد، حداکثر ظرف ۷۲ ساعت به حساب شما برمی‌گردد."}
          </p>
        )}
        {o.status === "EXPIRED" && (
          <p className={s.muted}>
            {o.paymentMethod === "CARD_TRANSFER"
              ? "این سفارش در مهلت تعیین‌شده پرداخت نشد و منقضی شد. اگر مبلغی واریز کرده‌اید، با فروشگاه تماس بگیرید."
              : "این سفارش پرداخت نشد و منقضی شد. اگر مبلغی از حساب شما کم شده باشد، حداکثر ظرف ۷۲ ساعت به حساب شما برمی‌گردد."}
          </p>
        )}
      </div>
      {data.transfer && receipt && <CardTransferPanel data={data} submit={receipt.submit} onSent={receipt.reload} />}
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
          {o.discountAmount > 0 && <div className={s.totalRow}><span>تخفیف ({o.discountCode})</span><span className={s.num}>− {toman(o.discountAmount)}</span></div>}
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
      {(data.canCancel || (data.canPay && pay)) && (
        <div className={s.actions}>
          {data.canPay && pay && <button type="button" className={s.button} onClick={pay} disabled={busy}>{busy ? "در حال انتقال به درگاه…" : "پرداخت اینترنتی"}</button>}
          {data.canCancel && <button type="button" className={`${s.button} ${s.ghost}`} onClick={cancel} disabled={busy}>لغو سفارش</button>}
        </div>
      )}
    </div>
  );
}
