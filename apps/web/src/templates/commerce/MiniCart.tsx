"use client";

import { useEffect, useRef, useState } from "react";
import { LINE_PROBLEM_MESSAGES } from "@store-builder/shared/modules/checkout/checkout";
import { getCart, problemText, setCartLine, type CartView } from "@/client/shop";
import { CART_EVENT } from "./cart-events";
import s from "./commerce.module.css";

const fa = (n: number) => n.toLocaleString("fa-IR");

/**
 * The cart as a panel that slides in from the edge (a native modal <dialog>: focus stays inside, Esc closes, focus returns to the button that opened it).
 * Loaded only when a shopper first opens it, so pages that never use it do not pay for it. The cart page stays the full view: this panel shows the lines,
 * lets the shopper change quantities or remove, and leads to the cart or checkout.
 */
export default function MiniCart({ cartHref, checkoutHref, productsHref, onClose }: { cartHref: string; checkoutHref: string; productsHref: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [cart, setCart] = useState<CartView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    let live = true;
    getCart().then((c) => live && setCart(c)).catch((e) => live && setError(problemText(e)));
    return () => { live = false; };
  }, []);

  async function change(productId: string, variantId: string | null, quantity: number) {
    setBusy(true);
    setError(null);
    try {
      const next = await setCartLine(productId, variantId, quantity);
      setCart(next);
      window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: { count: next.count } }));
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  }

  const blocked = !!cart?.lines.some((l) => l.problem);
  return (
    <dialog ref={dialog} className={s.drawer} aria-labelledby="mini-cart-title" onClose={onClose} onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
      <div className={s.drawerHead}>
        <h2 id="mini-cart-title" className={s.drawerTitle}>سبد خرید</h2>
        <button type="button" className={s.drawerClose} onClick={() => dialog.current?.close()} aria-label="بستن سبد خرید">×</button>
      </div>
      <div className={s.drawerBody}>
        {error && <p className={s.error} role="alert">{error}</p>}
        {!cart && !error && <p className={s.drawerMuted}>در حال بارگذاری…</p>}
        {cart && cart.lines.length === 0 && (
          <div>
            <p className={s.drawerMuted}>سبد خرید شما خالی است.</p>
            <a className={s.drawerGhost} href={productsHref}>مشاهدهٔ محصولات</a>
          </div>
        )}
        {cart && cart.lines.length > 0 && (
          <ul className={s.drawerLines} aria-label="کالاهای سبد">
            {cart.lines.map((l) => (
              <li key={`${l.productId}|${l.variantId ?? "-"}`} className={s.drawerLine}>
                <p className={s.drawerName}>{l.slug ? <a href={`/products/${encodeURIComponent(l.slug)}`}>{l.name}</a> : l.name}</p>
                {l.variantLabel && <p className={s.drawerMeta}>{l.variantLabel}</p>}
                <p className={s.drawerMeta}>{fa(l.unitPrice)} تومان</p>
                {l.problem && <p className={s.error}>{LINE_PROBLEM_MESSAGES[l.problem]}{l.problem === "not_enough_stock" && l.available !== null ? ` (موجودی: ${fa(l.available)})` : ""}</p>}
                <div className={s.drawerQty}>
                  <button type="button" disabled={busy || l.quantity <= 1} onClick={() => change(l.productId, l.variantId, l.quantity - 1)} aria-label={`یکی کمتر از ${l.name}`}>−</button>
                  <span aria-label="تعداد">{fa(l.quantity)}</span>
                  <button type="button" disabled={busy || l.quantity >= 1000} onClick={() => change(l.productId, l.variantId, l.quantity + 1)} aria-label={`یکی بیشتر از ${l.name}`}>+</button>
                  <button type="button" className={s.drawerRemove} disabled={busy} onClick={() => change(l.productId, l.variantId, 0)} aria-label={`حذف ${l.name} از سبد`}>حذف</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {cart && cart.lines.length > 0 && (
        <div className={s.drawerFoot}>
          <p className={s.drawerTotal}><span>جمع کالاها</span><strong>{fa(cart.subtotal)} تومان</strong></p>
          <a className={s.drawerPrimary} href={checkoutHref} aria-disabled={blocked || undefined}>ادامه‌ی خرید</a>
          <a className={s.drawerGhost} href={cartHref}>مشاهدهٔ سبد کامل</a>
        </div>
      )}
    </dialog>
  );
}
