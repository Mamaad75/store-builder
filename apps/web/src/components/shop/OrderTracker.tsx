"use client";

import { useEffect, useState } from "react";
import { cancelOrder, getOrder, problemText, type ShopperOrder } from "@/client/shop";
import OrderDetails from "./OrderDetails";
import s from "./shop.module.css";

/** The shopper's order page reached with the order link (guests). Cancelling is possible until the store confirms the order. */
export default function OrderTracker({ token }: { token: string }) {
  const [data, setData] = useState<ShopperOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getOrder(token).then(setData).catch((e) => setError(problemText(e)));
  }, [token]);

  async function cancel() {
    if (!window.confirm("سفارش لغو شود؟")) return;
    setBusy(true);
    setError(null);
    try {
      setData(await cancelOrder(token));
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className={s.page}>{error ? <p className={s.alert} role="alert">{error}</p> : <p className={s.muted}>در حال بارگذاری…</p>}</div>;
  return <OrderDetails data={data} error={error} busy={busy} cancel={cancel} />;
}
