"use client";

import { useEffect, useState } from "react";
import { sendMyReceipt, cancelMyOrder, goToGateway, myOrder, payMyOrder, problemText, type ShopperOrder } from "@/client/shop";
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

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const r = await payMyOrder(orderId);
      if (goToGateway(r.url)) return;
      setError("ارتباط با درگاه پرداخت برقرار نشد؛ کمی بعد دوباره تلاش کنید.");
    } catch (e) {
      setError(problemText(e));
    }
    setBusy(false);
  }

  if (!data) return <div className={s.page}>{error ? <p className={s.alert} role="alert">{error}</p> : <p className={s.muted}>در حال بارگذاری…</p>}</div>;
  return <OrderDetails data={data} error={error} busy={busy} cancel={cancel} pay={pay} receipt={{ submit: (img, f) => sendMyReceipt(orderId, img, f), reload: () => void myOrder(orderId).then(setData).catch(() => undefined) }} back={{ href: "/account", label: "بازگشت به حساب کاربری" }} />;
}
