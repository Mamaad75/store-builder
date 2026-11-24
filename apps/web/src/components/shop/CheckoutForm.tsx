"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PROVINCES } from "@store-builder/shared/modules/checkout/provinces";
import { LINE_PROBLEM_MESSAGES } from "@store-builder/shared/modules/checkout/checkout";
import { GATEWAY_LABELS, type Gateway } from "@store-builder/shared/modules/orders/orders";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { OrderNotReadyError } from "@store-builder/shared/modules/orders/errors";
import { goToGateway, me, myAddresses, payOrder, paymentMethods, placeOrder, problemText, quote, saveAddress, type CheckoutSummary, type CustomerProfile, type SavedAddress } from "@/client/shop";
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
  discount_invalid: "کد تخفیف واردشده قابل استفاده نیست؛ آن را حذف یا اصلاح کنید.",
};

/** The shopper's choice: cash on delivery, card-to-card, or one of the store's online gateways (D35c-1). */
type Method = "COD" | "CARD_TRANSFER" | Gateway;
const isGateway = (m: Method): m is Gateway => m === "ZARINPAL" || m === "AQAYEPARDAKHT";
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
 * order: cash on delivery, card-to-card, or (phase 3.5, D35c-1) online through one of the store's gateways: the order is placed first (awaiting payment, stock
 * held for 20 minutes), then the buyer is sent to the gateway. Every number shown comes from the server; nothing the page computes is sent.
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
  // Phase 3.3b: a signed-in customer picks a saved address (or a new one, optionally saved); guests type theirs.
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [selectedId, setSelectedId] = useState<string>("new");
  const [saveNew, setSaveNew] = useState(true);
  // Phase 3.5: the payment method; online only when the store takes it.
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [cardTransfer, setCardTransfer] = useState(false);
  const [method, setMethod] = useState<Method>("COD");
  const cod = method === "COD";
  // Phase 5.1: one discount code; `code` is what is applied (sent with every summary and the order), `codeInput` what is typed.
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const withCode = (c: string | null = code) => (c ? { discountCode: c } : {});

  // The cart part of the summary before any address (shows what is being bought), and who is shopping.
  useEffect(() => {
    quote({ cashOnDelivery: true }).then(setSummary).catch((e) => setError(problemText(e)));
    paymentMethods().then((m) => {
      setGateways(m.gateways);
      setCardTransfer(m.cardTransfer);
      if (m.gateways.length) setMethod(m.gateways[0]!);
    }).catch(() => undefined);
    me().then((c) => {
      if (!c) return;
      setCustomer(c);
      setAddress((a) => ({ ...a, recipientName: a.recipientName || (c.name ?? ""), phone: a.phone || `0${c.phone.slice(3)}` }));
      myAddresses().then((list) => {
        setSaved(list);
        if (list.length) setSelectedId(list[0]!.id);
      }).catch(() => undefined);
    });
  }, []);

  const usingSaved = selectedId !== "new";
  const addressBody = () => (usingSaved ? { addressId: selectedId } : { address });
  const pick = (id: string) => {
    setSelectedId(id);
    setShippingMethodId(null);
    if (summary?.shippingOptions.length) setSummary({ ...summary, shippingOptions: [], shippingMethodId: null });
  };

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
    const r = await run(() => quote({ ...addressBody(), ...(shippingMethodId ? { shippingMethodId } : {}), cashOnDelivery: cod, ...withCode() }));
    if (r) {
      setSummary(r);
      if (r.shippingMethodId === null && r.shippingOptions.length === 1) choose(r.shippingOptions[0]!.methodId);
    }
  }

  async function choose(id: string, m: Method = method) {
    setShippingMethodId(id);
    const r = await run(() => quote({ ...addressBody(), shippingMethodId: id, cashOnDelivery: m === "COD", ...withCode() }));
    if (r) setSummary(r);
  }

  /** Phase 5.1: apply or remove the code: the summary is asked for again (the server computes the discount). */
  async function applyCode(c: string | null) {
    setCode(c);
    const r = await run(() => quote({ ...addressBody(), ...(shippingMethodId ? { shippingMethodId } : {}), cashOnDelivery: cod, ...withCode(c) }));
    if (r) setSummary(r);
  }

  /** The cash-on-delivery fee depends on the method: the summary is asked for again. */
  function pickMethod(m: Method) {
    setMethod(m);
    if (shippingMethodId) void choose(shippingMethodId, m);
  }

  async function onPlace() {
    if (!shippingMethodId) return;
    const r = await run(async () => {
      if (customer && !usingSaved && saveNew) await saveAddress(address); // kept for the next purchase
      const payment = isGateway(method) ? { paymentMethod: "ONLINE", gateway: method } : { paymentMethod: method };
      return placeOrder({ requestKey, ...addressBody(), shippingMethodId, ...payment, ...withCode(), note });
    });
    if (!r) return;
    const orderPage = `/orders/${encodeURIComponent(r.accessToken)}`;
    if (r.order.status === "AWAITING_PAYMENT" && r.order.paymentMethod === "ONLINE") {
      setBusy(true);
      try {
        const p = await payOrder(r.accessToken);
        if (goToGateway(p.url)) return;
      } catch {
        // the order exists and waits for its payment: its page has a "pay" button
      }
      setBusy(false);
    }
    router.push(orderPage);
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
            {!customer && <p className={s.muted}>حساب دارید؟ <a href="/account?next=/checkout">وارد شوید</a> تا نشانی‌ها و سفارش‌هایتان در حسابتان بماند. خرید بدون ورود هم ممکن است.</p>}
            {saved.length > 0 && (
              <fieldset className={s.options}>
                <legend className={s.muted}>نشانی‌های ذخیره‌شده</legend>
                {saved.map((a) => (
                  <label key={a.id} className={s.option}>
                    <input type="radio" name="saved-address" checked={selectedId === a.id} onChange={() => pick(a.id)} />
                    <span>{a.recipientName} — {PROVINCES.find((p) => p.code === a.province)?.name ?? a.province}، {a.city}، {a.line}</span>
                  </label>
                ))}
                <label className={s.option}>
                  <input type="radio" name="saved-address" checked={selectedId === "new"} onChange={() => pick("new")} />
                  <span>نشانی جدید</span>
                </label>
              </fieldset>
            )}
            {!usingSaved && <>
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
            {customer && (
              <label className={s.option}>
                <input type="checkbox" checked={saveNew} onChange={(e) => setSaveNew(e.target.checked)} />
                <span>این نشانی را برای خریدهای بعدی ذخیره کن</span>
              </label>
            )}
            </>}
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
              {gateways.length > 0 || cardTransfer ? (
                <fieldset className={s.options}>
                  <legend className={s.muted}>روش پرداخت</legend>
                  {gateways.map((g) => (
                    <label key={g} className={s.option}>
                      <input type="radio" name="payment" checked={method === g} onChange={() => pickMethod(g)} disabled={busy} />
                      <span><strong>پرداخت اینترنتی — {GATEWAY_LABELS[g]}</strong> — با همه‌ی کارت‌های بانکی عضو شتاب</span>
                    </label>
                  ))}
                  {cardTransfer && (
                    <label className={s.option}>
                      <input type="radio" name="payment" checked={method === "CARD_TRANSFER"} onChange={() => pickMethod("CARD_TRANSFER")} disabled={busy} />
                      <span><strong>کارت به کارت</strong> — پس از ثبت سفارش شماره کارت فروشگاه نمایش داده می‌شود؛ تا ۲۴ ساعت رسید را بفرستید</span>
                    </label>
                  )}
                  <label className={s.option}>
                    <input type="radio" name="payment" checked={method === "COD"} onChange={() => pickMethod("COD")} disabled={busy} />
                    <span><strong>پرداخت در محل</strong> — هنگام تحویل</span>
                  </label>
                </fieldset>
              ) : (
                <p className={s.muted}>پرداخت در محل (هنگام تحویل).</p>
              )}

              <label className={s.field}>
                یادداشت برای فروشگاه (اختیاری)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </label>

              <div className={s.field}>
                <span>کد تخفیف</span>
                <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                  <input
                    value={code ?? codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    disabled={busy || code !== null}
                    dir="ltr"
                    autoComplete="off"
                    aria-label="کد تخفیف"
                    aria-invalid={summary.discountError ? true : undefined}
                    style={{ flex: "1 1 auto", minWidth: 0 }}
                  />
                  {code === null ? (
                    <button type="button" className={`${s.button} ${s.ghost}`} style={{ flex: "0 0 auto", whiteSpace: "nowrap", minHeight: 44 }} onClick={() => codeInput.trim() && applyCode(codeInput.trim())} disabled={busy || !codeInput.trim()}>اعمال</button>
                  ) : (
                    <button type="button" className={`${s.button} ${s.ghost}`} style={{ flex: "0 0 auto", whiteSpace: "nowrap", minHeight: 44 }} onClick={() => { setCodeInput(""); void applyCode(null); }} disabled={busy}>حذف کد</button>
                  )}
                </div>
                {summary.discountError && <span className={s.fieldError} role="alert">{summary.discountError.message}{summary.discountError.minOrder ? ` (حداقل ${toman(summary.discountError.minOrder)})` : ""}</span>}
                {summary.discount && <span className={s.muted}>کد {summary.discount.code} اعمال شد.</span>}
              </div>

              <div className={s.totals}>
                <div className={s.totalRow}><span>جمع کالاها</span><span className={s.num}>{toman(summary.subtotal)}</span></div>
                <div className={s.totalRow}><span>هزینه‌ی ارسال</span><span className={s.num}>{summary.shippingMethodId ? (summary.shippingCost === 0 ? "رایگان" : toman(summary.shippingCost)) : "—"}</span></div>
                {summary.codFee > 0 && <div className={s.totalRow}><span>کارمزد پرداخت در محل</span><span className={s.num}>{toman(summary.codFee)}</span></div>}
                {summary.discount && (
                  <div className={s.totalRow}>
                    <span>تخفیف ({summary.discount.code}{summary.discount.shippingDiscount > 0 ? "، ارسال رایگان" : ""})</span>
                    <span className={s.num}>− {toman(summary.discount.amount)}</span>
                  </div>
                )}
                <div className={`${s.totalRow} ${s.grand}`}><span>مبلغ قابل پرداخت</span><span className={s.num}>{toman(summary.total)}</span></div>
              </div>
              {!summary.ready && summary.blockers.length > 0 && <p className={s.alert}>{summary.blockers.map((b) => BLOCKERS[b] ?? b).join(" ")}</p>}
              <div className={s.actions}>
                <button className={s.button} type="button" onClick={onPlace} disabled={busy || !summary.ready}>{busy ? "در حال ثبت…" : isGateway(method) ? "ثبت سفارش و پرداخت" : method === "CARD_TRANSFER" ? "ثبت سفارش و دریافت شماره کارت" : "ثبت سفارش"}</button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
