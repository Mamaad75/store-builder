"use client";

import { useEffect, useState } from "react";
import { cancelMyOrder, myOrder, problemText, type ShopperOrder } from "@/client/shop";
import OrderDetails from "./OrderDetails";
import s from "./shop.module.css";

/** One order of the signed-in customer (phase 3.3b), from their account page. */
export default function MyOrder({ orderId }: { orderId: string }) {
  const [data, setData] = useState<ShopperOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    myOrder(orderId).then(setData).catch((e) => setError(problemText(e)));
  }, [orderId]);

  async function cancel() {
    if (!window.confirm("سفارش لغو شود؟")) return;
    setBusy(true);
    setError(null);
    try {
      setData(await cancelMyOrder(orderId));
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className={s.page}>{error ? <p className={s.alert} role="alert">{error}</p> : <p className={s.muted}>در حال بارگذاری…</p>}</div>;
  return <OrderDetails data={data} error={error} busy={busy} cancel={cancel} back={{ href: "/account", label: "بازگشت به حساب کاربری" }} />;
}
