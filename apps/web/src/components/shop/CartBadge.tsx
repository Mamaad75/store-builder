"use client";

import { useEffect, useState } from "react";
import { getCart } from "@/client/shop";
import { faNumber } from "./format";
import s from "./shop.module.css";

/** A floating "cart (n)" link on the live store, shown only when the cart has something in it (every theme, no header changes). */
export default function CartBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    getCart().then((c) => setCount(c.count)).catch(() => setCount(0));
  }, []);
  if (count <= 0) return null;
  return (
    <a className={s.badge} href="/cart" aria-label={`سبد خرید، ${faNumber(count)} کالا`}>
      سبد خرید <span className={s.num}>({faNumber(count)})</span>
    </a>
  );
}
