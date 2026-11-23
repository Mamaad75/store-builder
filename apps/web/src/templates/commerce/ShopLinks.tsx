"use client";

import { useEffect, useState } from "react";
import { getCart } from "@/client/shop";
import s from "./commerce.module.css";

/** Other shop components announce a new cart size with this event (the header badge updates without a reload). */
export const CART_EVENT = "shop:cart";

const fa = (n: number) => n.toLocaleString("fa-IR");

/** Account and cart icons in the store's header; the cart shows how many items it holds. */
export default function ShopLinks({ accountHref, cartHref }: { accountHref: string; cartHref: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    getCart().then((c) => live && setCount(c.count)).catch(() => undefined);
    const onChange = (e: Event) => setCount((e as CustomEvent<{ count: number }>).detail.count);
    window.addEventListener(CART_EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(CART_EVENT, onChange);
    };
  }, []);
  return (
    <nav className={s.nav} aria-label="حساب و سبد خرید">
      <a className={s.navLink} href={accountHref} aria-label="حساب کاربری">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
      </a>
      <a className={s.navLink} href={cartHref} aria-label={count > 0 ? `سبد خرید، ${fa(count)} کالا` : "سبد خرید"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7h14l-1.2 12.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 7Z" /><path d="M9 7V6a3 3 0 0 1 6 0v1" /></svg>
        {count > 0 && <span className={s.count} aria-hidden="true">{count > 99 ? "۹۹+" : fa(count)}</span>}
      </a>
    </nav>
  );
}
