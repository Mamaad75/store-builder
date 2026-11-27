"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { getCart } from "@/client/shop";
import { CART_EVENT, CART_OPEN_EVENT } from "./cart-events";
import s from "./commerce.module.css";

export { CART_EVENT };

// loaded on first use; rendered only after a click, so it never takes part in server rendering
const MiniCart = lazy(() => import("./MiniCart"));

const fa = (n: number) => n.toLocaleString("fa-IR");

/** Account and cart icons in the store's header; the cart shows how many items it holds. */
export default function ShopLinks({ accountHref, cartHref, checkoutHref, productsHref }: { accountHref: string; cartHref: string; checkoutHref: string; productsHref: string }) {
  const [count, setCount] = useState(0);
  const [panel, setPanel] = useState(0); // 0 = closed; every opening gets a new number so the panel loads the cart afresh
  useEffect(() => {
    let live = true;
    getCart().then((c) => live && setCount(c.count)).catch(() => undefined);
    const onChange = (e: Event) => setCount((e as CustomEvent<{ count: number }>).detail.count);
    const onOpen = () => {
      setPanel((n) => n + 1);
      window.dispatchEvent(new Event(CART_OPEN_EVENT + ":ack")); // tells "add to cart" that a cart panel answered
    };
    window.addEventListener(CART_EVENT, onChange);
    window.addEventListener(CART_OPEN_EVENT, onOpen);
    return () => {
      live = false;
      window.removeEventListener(CART_EVENT, onChange);
      window.removeEventListener(CART_OPEN_EVENT, onOpen);
    };
  }, []);
  /** A plain click opens the panel; modified clicks, and the cart or checkout pages themselves, keep the normal link. */
  function openPanel(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const here = window.location.pathname;
    if (here === cartHref || here === checkoutHref) return;
    e.preventDefault();
    setPanel((n) => n + 1);
  }
  return (
    <nav className={s.nav} aria-label="حساب و سبد خرید">
      <a className={s.navLink} href={accountHref} aria-label="حساب کاربری">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
      </a>
      <a className={s.navLink} href={cartHref} onClick={openPanel} aria-haspopup="dialog" aria-label={count > 0 ? `سبد خرید، ${fa(count)} کالا` : "سبد خرید"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7h14l-1.2 12.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 7Z" /><path d="M9 7V6a3 3 0 0 1 6 0v1" /></svg>
        {count > 0 && <span className={s.count} aria-hidden="true">{count > 99 ? "۹۹+" : fa(count)}</span>}
      </a>
      {panel > 0 && <Suspense fallback={null}><MiniCart key={panel} cartHref={cartHref} checkoutHref={checkoutHref} productsHref={productsHref} onClose={() => setPanel(0)} /></Suspense>}
    </nav>
  );
}
