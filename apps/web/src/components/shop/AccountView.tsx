"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ORDER_STATUS_LABELS } from "@store-builder/shared/modules/orders/orders";
import { provinceName } from "@store-builder/shared/modules/checkout/provinces";
import { formatIranMobile } from "@store-builder/shared/lib/phone";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import {
  customerStatus, deleteAddress, login, logout, me, myAddresses, myOrders, problemText, register, requestCode, safeNext, verifyCode,
  type CustomerProfile, type SavedAddress, type ShopperOrder,
} from "@/client/shop";
import { faNumber, toman } from "./format";
import s from "./shop.module.css";

type Mode = "login" | "register" | "otp";
const date = (iso: string) => new Date(iso).toLocaleDateString("fa-IR", { dateStyle: "medium" });

function SignIn({ otpEnabled, onDone }: { otpEnabled: boolean; onDone: (c: CustomerProfile) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  async function run(f: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await f();
    } catch (e) {
      if (e instanceof ValidationError) setFieldErrors(e.fieldErrors);
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") void run(async () => onDone((await login(phone, password)).customer));
    else if (mode === "register") void run(async () => onDone((await register({ phone, name, password })).customer));
    else if (!codeSent) void run(async () => { await requestCode(phone); setCodeSent(true); });
    else void run(async () => onDone((await verifyCode(phone, code)).customer));
  };
  const err = (k: string) => fieldErrors[k]?.[0];
  const tabs: [Mode, string][] = [["login", "ورود با رمز"], ["register", "ثبت‌نام"], ...(otpEnabled ? ([["otp", "ورود با کد پیامکی"]] as [Mode, string][]) : [])];

  return (
    <div className={s.card}>
      <div className={s.actions} role="tablist" aria-label="روش ورود">
        {tabs.map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? s.button : `${s.button} ${s.ghost}`} onClick={() => { setMode(m); setError(null); setFieldErrors({}); setCodeSent(false); }}>{label}</button>
        ))}
      </div>
      <form className={s.totals} onSubmit={submit} noValidate>
        {mode === "register" && (
          <label className={s.field}>
            نام و نام خانوادگی
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required aria-invalid={err("name") ? true : undefined} />
            {err("name") && <span className={s.fieldError}>{err("name")}</span>}
          </label>
        )}
        <label className={s.field}>
          شماره‌ی موبایل
          <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" dir="ltr" placeholder="09123456789" required disabled={mode === "otp" && codeSent} aria-invalid={err("phone") ? true : undefined} />
          {err("phone") && <span className={s.fieldError}>{err("phone")}</span>}
        </label>
        {mode !== "otp" && (
          <label className={s.field}>
            رمز عبور{mode === "register" ? " (حداقل ۸ نویسه)" : ""}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} required aria-invalid={err("password") ? true : undefined} />
            {err("password") && <span className={s.fieldError}>{err("password")}</span>}
          </label>
        )}
        {mode === "otp" && codeSent && (
          <label className={s.field}>
            کد ۶ رقمی پیامک‌شده
            <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" dir="ltr" maxLength={6} required />
          </label>
        )}
        {error && <p className={s.alert} role="alert">{error}</p>}
        <div className={s.actions}>
          <button className={s.button} type="submit" disabled={busy}>
            {busy ? "لطفاً صبر کنید…" : mode === "login" ? "ورود" : mode === "register" ? "ثبت‌نام" : codeSent ? "تأیید کد" : "ارسال کد"}
          </button>
        </div>
        {mode === "register" && <p className={s.muted}>با ورود با کد پیامکی، شماره‌ی شما تأیید می‌شود و سفارش‌هایی که قبلاً بدون ورود ثبت کرده‌اید هم در حسابتان دیده می‌شوند.</p>}
      </form>
    </div>
  );
}

/** The shopper's account in this store (phase 3.3b): sign in or register, then their orders and saved addresses. */
export default function AccountView() {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerProfile | null | undefined>(undefined);
  const [otpEnabled, setOtpEnabled] = useState(false);
  const [orders, setOrders] = useState<ShopperOrder[]>([]);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    customerStatus().then((st) => setOtpEnabled(st.otpEnabled)).catch(() => undefined);
    me().then(setCustomer);
  }, []);

  useEffect(() => {
    if (!customer) return;
    myOrders().then(setOrders).catch((e) => setError(problemText(e)));
    myAddresses().then(setAddresses).catch(() => undefined);
  }, [customer]);

  function signedIn(c: CustomerProfile) {
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    if (next !== "/account") window.location.assign(next);
    else setCustomer(c);
  }

  async function signOut() {
    await logout().catch(() => undefined);
    router.push("/");
    router.refresh(); // the header icons and any signed-in view follow
  }

  async function removeAddress(id: string) {
    try {
      await deleteAddress(id);
      setAddresses((a) => a.filter((x) => x.id !== id));
    } catch (e) {
      setError(problemText(e));
    }
  }

  if (customer === undefined) return <div className={s.page}><p className={s.muted}>در حال بارگذاری…</p></div>;
  if (customer === null) {
    return (
      <div className={s.page}>
        <h1 className={s.title}>ورود یا ثبت‌نام</h1>
        <p className={s.muted}>برای خرید لازم نیست وارد شوید؛ با ورود، سفارش‌ها و نشانی‌هایتان یک‌جا می‌مانند.</p>
        <SignIn otpEnabled={otpEnabled} onDone={signedIn} />
      </div>
    );
  }
  return (
    <div className={s.page}>
      <h1 className={s.title}>حساب کاربری</h1>
      {error && <p className={s.alert} role="alert">{error}</p>}
      <div className={s.card}>
        <p className={s.lineName}>{customer.name ?? "مشتری"}</p>
        <p className={s.muted} dir="ltr" style={{ textAlign: "end" }}>{formatIranMobile(customer.phone)}</p>
        {!customer.phoneVerified && (
          <p className={s.muted}>
            شماره‌ی شما هنوز با کد پیامکی تأیید نشده است؛ سفارش‌هایی که بدون ورود با این شماره ثبت شده‌اند پس از تأیید شماره نمایش داده می‌شوند.
            {otpEnabled ? " برای تأیید، خارج شوید و با کد پیامکی وارد شوید." : ""}
          </p>
        )}
        <div className={s.actions}><button type="button" className={`${s.button} ${s.ghost}`} onClick={signOut}>خروج</button></div>
      </div>

      <section className={s.card} aria-labelledby="acc-orders">
        <h2 id="acc-orders" className={s.lineName}>سفارش‌های من</h2>
        {orders.length === 0 ? <p className={s.muted}>هنوز سفارشی ثبت نکرده‌اید.</p> : (
          <ul className={s.lines}>
            {orders.map(({ order: o }) => (
              <li key={o.id} className={s.line}>
                <div>
                  <p className={s.lineName}><a href={`/account/orders/${encodeURIComponent(o.id)}`}>سفارش {faNumber(o.number)}</a></p>
                  <p className={s.lineMeta}>{date(o.createdAt)} — {faNumber(o.itemCount)} کالا</p>
                </div>
                <div style={{ textAlign: "end" }}>
                  <span className={s.status}>{ORDER_STATUS_LABELS[o.status]}</span>
                  <p className={`${s.lineMeta} ${s.num}`}>{toman(o.total)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.card} aria-labelledby="acc-addr">
        <h2 id="acc-addr" className={s.lineName}>نشانی‌های من</h2>
        {addresses.length === 0 ? <p className={s.muted}>نشانی ذخیره‌شده‌ای ندارید؛ هنگام خرید می‌توانید نشانی را ذخیره کنید.</p> : (
          <ul className={s.lines}>
            {addresses.map((a) => (
              <li key={a.id} className={s.line}>
                <p className={s.lineMeta}>{a.recipientName} — {provinceName(a.province) ?? a.province}، {a.city}، {a.line} — {a.postalCode}</p>
                <button type="button" className={s.linkBtn} onClick={() => removeAddress(a.id)}>حذف</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
