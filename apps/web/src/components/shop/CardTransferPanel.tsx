"use client";

import { useState } from "react";
import { RECEIPT_STATUS_LABELS, formatCardNumber } from "@store-builder/shared/modules/orders/card-transfer";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { problemText, type ShopperOrder } from "@/client/shop";
import { toman } from "./format";
import s from "./shop.module.css";

const MAX_FILE = 5 * 1024 * 1024;
const date = (iso: string) => new Date(iso).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });

/**
 * D35b-1: card-to-card on the shopper's order page: the store's cards and the exact amount (with copy buttons), the receipts sent so far
 * with the store's decision, and the receipt form (image + bank tracking number + last 4 digits of the paying card).
 */
export default function CardTransferPanel({
  data,
  submit,
  onSent,
}: {
  data: ShopperOrder;
  submit: (image: File, f: { trackingCode: string; payerCardLast4: string }) => Promise<void>;
  onSent: () => void;
}) {
  const t = data.transfer!;
  const o = data.order;
  const [file, setFile] = useState<File | null>(null);
  const [trackingCode, setTracking] = useState("");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (!file) return setError("تصویر رسید را انتخاب کنید.");
    if (file.size > MAX_FILE) return setError("حجم تصویر رسید حداکثر ۵ مگابایت است.");
    setBusy(true);
    try {
      await submit(file, { trackingCode, payerCardLast4: last4 });
      setFile(null);
      setTracking("");
      setLast4("");
      onSent();
    } catch (err) {
      if (err instanceof ValidationError) {
        setFieldErrors(err.fieldErrors);
        setError("لطفاً اطلاعات مشخص‌شده را اصلاح کنید.");
      } else setError(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => fieldErrors[k]?.[0];
  return (
    <section className={s.card} aria-labelledby="ct-title">
      <h2 id="ct-title" className={s.lineName}>پرداخت کارت به کارت</h2>
      {o.status === "AWAITING_PAYMENT" && t.cards.length === 0 && !t.canSubmit && !data.storeOpen && (
        <p className={s.muted}>این فروشگاه در حال حاضر پرداخت نمی‌پذیرد. اگر سفارش تا پایان مهلت پرداخت نشود، لغو و کالاها آزاد می‌شوند.</p>
      )}
      {o.status === "AWAITING_PAYMENT" && t.cards.length > 0 && (
        <>
          <p className={s.muted}>
            مبلغ <strong className={s.num}>{toman(o.total)}</strong>{" "}
            <button type="button" className={s.linkBtn} onClick={() => copy(String(o.total * 10), "amount")}>{copied === "amount" ? "کپی شد" : "کپی مبلغ به ریال"}</button>{" "}
            را به یکی از کارت‌های زیر واریز کنید و رسید را همین‌جا بفرستید.
            {o.paymentDeadline ? ` مهلت ارسال رسید: ${date(o.paymentDeadline)}.` : ""}
          </p>
          <ul className={s.lines}>
            {t.cards.map((c) => (
              <li key={c.cardNumber} className={s.line}>
                <div>
                  <p className={s.lineName}><span dir="ltr" className={s.num}>{formatCardNumber(c.cardNumber)}</span></p>
                  <p className={s.lineMeta}>{c.holderName}{c.bankName ? ` — ${c.bankName}` : ""}</p>
                </div>
                <button type="button" className={`${s.button} ${s.ghost}`} onClick={() => copy(c.cardNumber, c.cardNumber)}>{copied === c.cardNumber ? "کپی شد" : "کپی شماره کارت"}</button>
              </li>
            ))}
          </ul>
        </>
      )}

      {t.receipts.length > 0 && (
        <ul className={s.history}>
          {t.receipts.map((r, n) => (
            <li key={n}>
              رسید {date(r.createdAt)} (کارت ...{r.payerCardLast4}): <strong>{RECEIPT_STATUS_LABELS[r.status]}</strong>
              {r.status === "REJECTED" && r.reviewNote ? ` — دلیل: ${r.reviewNote}` : ""}
            </li>
          ))}
        </ul>
      )}
      {t.receipts.some((r) => r.status === "SUBMITTED") && <p className={s.ok}>رسید شما دریافت شد و در انتظار بررسی فروشگاه است. نتیجه همین‌جا نمایش داده می‌شود.</p>}

      {t.canSubmit && (
        <form onSubmit={onSubmit} className={s.card} noValidate>
          <h3 className={s.lineName}>ارسال رسید</h3>
          {error && <p className={s.alert} role="alert">{error}</p>}
          <label className={s.field}>
            تصویر رسید (عکس یا اسکرین‌شات، حداکثر ۵ مگابایت)
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </label>
          <div className={s.grid}>
            <label className={s.field}>
              شماره‌ی پیگیری / ارجاع
              <input value={trackingCode} onChange={(e) => setTracking(e.target.value)} inputMode="numeric" dir="ltr" autoComplete="off" aria-invalid={err("trackingCode") ? true : undefined} required />
              {err("trackingCode") && <span className={s.fieldError}>{err("trackingCode")}</span>}
            </label>
            <label className={s.field}>
              ۴ رقم آخر کارت پرداخت‌کننده
              <input value={last4} onChange={(e) => setLast4(e.target.value)} inputMode="numeric" dir="ltr" maxLength={4} autoComplete="off" aria-invalid={err("payerCardLast4") ? true : undefined} required />
              {err("payerCardLast4") && <span className={s.fieldError}>{err("payerCardLast4")}</span>}
            </label>
          </div>
          <div className={s.actions}><button className={s.button} type="submit" disabled={busy}>{busy ? "در حال ارسال…" : "ارسال رسید"}</button></div>
        </form>
      )}
    </section>
  );
}
