"use client";

import { useEffect, useState } from "react";
import { LINE_PROBLEM_MESSAGES } from "@store-builder/shared/modules/checkout/checkout";
import { getCart, problemText, setCartLine, type CartView as Cart } from "@/client/shop";
import { faNumber, toman } from "./format";
import s from "./shop.module.css";

/** The cart (phase 3.3): current prices from the published store, problems per line, quantities and removal. */
export default function CartView() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCart().then(setCart).catch((e) => setError(problemText(e)));
  }, []);

  async function change(productId: string, variantId: string | null, quantity: number) {
    setBusy(true);
    setError(null);
    try {
      setCart(await setCartLine(productId, variantId, quantity));
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.page}>
      <h1 className={s.title}>سبد خرید</h1>
      {error && <p className={s.alert} role="alert">{error}</p>}
      {!cart && !error && <p className={s.muted}>در حال بارگذاری…</p>}
      {cart && cart.lines.length === 0 && (
        <div className={s.card}>
          <p className={s.muted}>سبد خرید شما خالی است.</p>
          <div className={s.actions}><a className={s.button} href="/products">مشاهده‌ی محصولات</a></div>
        </div>
      )}
      {cart && cart.lines.length > 0 && (
        <>
          <ul className={s.lines} aria-label="کالاهای سبد">
            {cart.lines.map((l) => (
              <li key={`${l.productId}|${l.variantId ?? "-"}`} className={s.line}>
                <div>
                  <p className={s.lineName}>{l.slug ? <a href={`/products/${encodeURIComponent(l.slug)}`}>{l.name}</a> : l.name}</p>
                  {l.variantLabel && <p className={s.lineMeta}>{l.variantLabel}</p>}
                  <p className={s.lineMeta}>قیمت واحد: <span className={s.num}>{toman(l.unitPrice)}</span></p>
                  {l.problem && (
                    <p className={s.problem}>
                      {LINE_PROBLEM_MESSAGES[l.problem]}
                      {l.problem === "not_enough_stock" && l.available !== null ? ` (موجودی: ${faNumber(l.available)})` : ""}
                    </p>
                  )}
                </div>
                <div className={s.qtyRow}>
                  <button type="button" className={s.qtyBtn} disabled={busy || l.quantity <= 1} onClick={() => change(l.productId, l.variantId, l.quantity - 1)} aria-label={`یکی کمتر از ${l.name}`}>−</button>
                  <span className={s.num} aria-label="تعداد">{faNumber(l.quantity)}</span>
                  <button type="button" className={s.qtyBtn} disabled={busy || l.quantity >= 1000} onClick={() => change(l.productId, l.variantId, l.quantity + 1)} aria-label={`یکی بیشتر از ${l.name}`}>+</button>
                  <button type="button" className={s.linkBtn} disabled={busy} onClick={() => change(l.productId, l.variantId, 0)}>حذف</button>
                </div>
              </li>
            ))}
          </ul>
          <div className={s.card}>
            <div className={`${s.totalRow} ${s.grand}`}><span>جمع کالاها</span><span className={s.num}>{toman(cart.subtotal)}</span></div>
            <p className={s.muted}>هزینه‌ی ارسال در مرحله‌ی بعد، بعد از وارد کردن نشانی، حساب می‌شود.</p>
            <div className={s.actions}>
              <a className={s.button} href="/checkout" aria-disabled={cart.lines.some((l) => l.problem) || undefined}>ادامه‌ی خرید</a>
              <a className={`${s.button} ${s.ghost}`} href="/products">ادامه‌ی تماشای محصولات</a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
