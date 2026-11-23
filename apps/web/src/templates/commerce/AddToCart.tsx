"use client";

import { useState } from "react";
import { addToCart, problemText } from "@/client/shop";
import s from "./commerce.module.css";

export interface BuyableVariant {
  id: string;
  label: string;
  inStock: boolean;
}

/**
 * "Add to cart" on a product page of the LIVE store (phase 3.3). A product with variants needs one chosen (only those in stock are
 * offered). After adding, the shopper goes to the cart. Prices are never sent: the server prices the cart from the published store.
 */
export default function AddToCart({ productId, productName, variants, cartHref }: { productId: string; productName: string; variants: BuyableVariant[]; cartHref: string }) {
  const available = variants.filter((v) => v.inStock);
  const [variantId, setVariantId] = useState<string>(available[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (variants.length > 0 && available.length === 0) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addToCart(productId, variants.length > 0 ? variantId : null, quantity);
      window.location.assign(cartHref);
    } catch (err) {
      setError(problemText(err));
      setBusy(false);
    }
  }

  return (
    <form className={s.buy} onSubmit={onSubmit} aria-label={`خرید ${productName}`}>
      <div className={s.row}>
        {variants.length > 0 && (
          <label className={s.field}>
            نوع کالا
            <select value={variantId} onChange={(e) => setVariantId(e.target.value)} required>
              {available.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
        )}
        <label className={s.field}>
          تعداد
          <input className={s.qty} type="number" inputMode="numeric" min={1} max={1000} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
        </label>
        <button className={s.button} type="submit" disabled={busy}>{busy ? "در حال افزودن…" : "افزودن به سبد خرید"}</button>
      </div>
      {error && <p className={s.error} role="alert">{error}</p>}
    </form>
  );
}
