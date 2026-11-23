"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PROVINCES } from "@store-builder/shared/modules/checkout/provinces";
import { LINE_PROBLEM_MESSAGES } from "@store-builder/shared/modules/checkout/checkout";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { OrderNotReadyError } from "@store-builder/shared/modules/orders/errors";
import { placeOrder, problemText, quote, type CheckoutSummary } from "@/client/shop";
import { faNumber, toman } from "./format";
import s from "./shop.module.css";

const BLOCKERS: Record<string, string> = {
  empty_cart: "سبد خرید خالی است.",
  line_problems: "بعضی کالاهای سبد قابل خرید نیستند؛ به سبد خرید برگردید و آن‌ها را اصلاح کنید.",
  no_address: "نشانی تحویل را وارد کنید.",
  no_shipping_for_province: "فروشگاه به این استان ارسال ندارد.",
  choose_shipping: "روش ارسال را انتخاب کنید.",
  shipping_unavailable: "روش ارسال انتخاب‌شده برای این نشانی در دسترس نیست.",
  cod_unavailable: "پرداخت در محل برای این روش ارسال و نشانی ممکن نیست.",
};

type Address = { recipientName: string; phone: string; province: string; city: string; line: string; postalCode: string };
const EMPTY: Address = { recipientName: "", phone: "", province: "", city: "", line: "", postalCode: "" };
const FIELDS: { key: keyof Address; label: string; autoComplete: string; inputMode?: "numeric" | "tel" }[] = [
  { key: "recipientName", label: "نام و نام خانوادگی گیرنده", autoComplete: "name" },
  { key: "phone", label: "موبایل", autoComplete: "tel", inputMode: "tel" },
  { key: "city", label: "شهر", autoComplete: "address-level2" },
  { key: "postalCode", label: "کد پستی (۱۰ رقم)", autoComplete: "postal-code", inputMode: "numeric" },
];

/**
 * Checkout (phases 3.3/3.4): the delivery address, then the shipping methods the store offers for that province with their cost, then the
 * order (cash on delivery until online payment arrives). Every number shown comes from the server; nothing the page computes is sent.
 */
export default function CheckoutForm({ requestKey }: { requestKey: string }) {
  const router = useRouter();
  const [address, setAddress] = useState<Address>(EMPTY);
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState<CheckoutSummary | null>(null);
  const [shippingMethodId, setShippingMethodId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The cart part of the summary before any address (shows what is being bought).
  useEffect(() => {
    quote({ cashOnDelivery: true }).then(setSummary).catch((e) => setError(problemText(e)));
  }, []);

  const set = (k: keyof Address, v: string) => {
    setAddress((a) => ({ ...a, [k]: v }));
    if (summary?.shippingOptions.length) setSummary({ ...summary, shippingOptions: [] }); // an address change needs a new quote
  };

  async function run<T>(f: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      return await f();
    } catch (e) {
      if (e instanceof ValidationError) {
        setFieldErrors(e.fieldErrors);
        setError("لطفاً اطلاعات مشخص‌شده را اصلاح کنید.");
      } else if (e instanceof OrderNotReadyError) setError(e.blockers.map((b) => BLOCKERS[b] ?? b).join(" "));
      else setError(problemText(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onQuote(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(() => quote({ address, ...(shippingMethodId ? { shippingMethodId } : {}), cashOnDelivery: true }));
    if (r) {
      setSummary(r);
      if (r.shippingMethodId === null && r.shippingOptions.length === 1) choose(r.shippingOptions[0]!.methodId);
    }
  }

  async function choose(id: string) {
    setShippingMethodId(id);
    const r = await run(() => quote({ address, shippingMethodId: id, cashOnDelivery: true }));
    if (r) setSummary(r);
  }

  async function onPlace() {
    if (!shippingMethodId) return;
    const r = await run(() => placeOrder({ requestKey, address, shippingMethodId, paymentMethod: "COD", note }));
    if (r) router.push(`/orders/${encodeURIComponent(r.accessToken)}`);
  }

  const err = (k: string) => fieldErrors[k]?.[0];
  const hasOptions = (summary?.shippingOptions.length ?? 0) > 0;
  const lines = summary?.lines ?? [];

  return (
    <div className={s.page}>
      <h1 className={s.title}>تکمیل خرید</h1>
      {error && <p className={s.alert} role="alert">{error}</p>}

      {summary && lines.length === 0 && (
        <div className={s.card}>
          <p className={s.muted}>سبد خرید شما خالی است.</p>
          <div className={s.actions}><a className={s.button} href="/products">مشاهده‌ی محصولات</a></div>
        </div>
      )}

      {lines.length > 0 && (
        <>
          <section className={s.card} aria-labelledby="co-items">
            <h2 id="co-items" className={s.lineName}>کالاها</h2>
            <ul className={s.lines}>
              {lines.map((l) => (
                <li key={`${l.productId}|${l.variantId ?? "-"}`} className={s.line}>
                  <div>
                    <p className={s.lineName}>{l.name} <span className={s.num}>× {faNumber(l.quantity)}</span></p>
                    {l.variantLabel && <p className={s.lineMeta}>{l.variantLabel}</p>}
                    {l.problem && <p className={s.problem}>{LINE_PROBLEM_MESSAGES[l.problem]}</p>}
                  </div>
                  <span className={s.num}>{toman(l.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <a href="/cart">ویرایش سبد خرید</a>
          </section>

          <form className={s.card} onSubmit={onQuote} aria-labelledby="co-address" noValidate>
            <h2 id="co-address" className={s.lineName}>نشانی تحویل</h2>
            <div className={s.grid}>
              {FIELDS.slice(0, 2).map((f) => (
                <label key={f.key} className={s.field}>
                  {f.label}
                  <input value={address[f.key]} onChange={(e) => set(f.key, e.target.value)} autoComplete={f.autoComplete} inputMode={f.inputMode} aria-invalid={err(f.key) ? true : undefined} required />
                  {err(f.key) && <span className={s.fieldError}>{err(f.key)}</span>}
                </label>
              ))}
              <label className={s.field}>
                استان
                <select value={address.province} onChange={(e) => set("province", e.target.value)} aria-invalid={err("province") ? true : undefined} required>
                  <option value="">انتخاب کنید</option>
                  {PROVINCES.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </select>
                {err("province") && <span className={s.fieldError}>{err("province")}</span>}
              </label>
              {FIELDS.slice(2).map((f) => (
                <label key={f.key} className={s.field}>
                  {f.label}
                  <input value={address[f.key]} onChange={(e) => set(f.key, e.target.value)} autoComplete={f.autoComplete} inputMode={f.inputMode} list={f.key === "city" ? "co-cities" : undefined} aria-invalid={err(f.key) ? true : undefined} required />
                  {err(f.key) && <span className={s.fieldError}>{err(f.key)}</span>}
                </label>
              ))}
            </div>
            <datalist id="co-cities">{(PROVINCES.find((p) => p.code === address.province)?.cities ?? []).map((c) => <option key={c} value={c} />)}</datalist>
            <label className={s.field}>
              نشانی کامل (خیابان، کوچه، پلاک، واحد)
              <textarea value={address.line} onChange={(e) => set("line", e.target.value)} autoComplete="street-address" aria-invalid={err("line") ? true : undefined} required />
              {err("line") && <span className={s.fieldError}>{err("line")}</span>}
            </label>
            {!hasOptions && <div className={s.actions}><button className={s.button} type="submit" disabled={busy}>{busy ? "در حال بررسی…" : "نمایش روش‌های ارسال"}</button></div>}
          </form>

          {hasOptions && summary && (
            <section className={s.card} aria-labelledby="co-ship">
              <h2 id="co-ship" className={s.lineName}>روش ارسال</h2>
              <fieldset className={s.options}>
                <legend className={s.muted}>یکی را انتخاب کنید</legend>
                {summary.shippingOptions.map((o) => (
                  <label key={o.methodId} className={s.option}>
                    <input type="radio" name="shipping" checked={shippingMethodId === o.methodId} onChange={() => choose(o.methodId)} disabled={busy} />
                    <span>
                      <strong>{o.name}</strong> — <span className={s.num}>{o.cost === 0 ? "رایگان" : toman(o.cost)}</span>
                      {o.freeByThreshold && <span className={s.muted}> (ارسال رایگان برای این مبلغ خرید)</span>}
                      {o.description && <span className={s.lineMeta}><br />{o.description}</span>}
                      {!o.cashOnDelivery.available && <span className={s.problem}><br />پرداخت در محل برای این روش ممکن نیست.</span>}
                    </span>
                  </label>
                ))}
              </fieldset>

              <h2 className={s.lineName}>پرداخت</h2>
              <p className={s.muted}>پرداخت در محل (هنگام تحویل). پرداخت آنلاین به‌زودی اضافه می‌شود.</p>

              <label className={s.field}>
                یادداشت برای فروشگاه (اختیاری)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </label>

              <div className={s.totals}>
                <div className={s.totalRow}><span>جمع کالاها</span><span className={s.num}>{toman(summary.subtotal)}</span></div>
                <div className={s.totalRow}><span>هزینه‌ی ارسال</span><span className={s.num}>{summary.shippingMethodId ? (summary.shippingCost === 0 ? "رایگان" : toman(summary.shippingCost)) : "—"}</span></div>
                {summary.codFee > 0 && <div className={s.totalRow}><span>کارمزد پرداخت در محل</span><span className={s.num}>{toman(summary.codFee)}</span></div>}
                <div className={`${s.totalRow} ${s.grand}`}><span>مبلغ قابل پرداخت</span><span className={s.num}>{toman(summary.total)}</span></div>
              </div>
              {!summary.ready && summary.blockers.length > 0 && <p className={s.alert}>{summary.blockers.map((b) => BLOCKERS[b] ?? b).join(" ")}</p>}
              <div className={s.actions}>
                <button className={s.button} type="button" onClick={onPlace} disabled={busy || !summary.ready}>{busy ? "در حال ثبت…" : "ثبت سفارش"}</button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
