/**
 * The 404 of every page. Plain HTML and CSS on purpose: the root not-found element is part of every route's page data, so a UI library imported
 * here would be downloaded by every storefront page. A store's own host has a themed 404 of its own; the dashboard and the
 * platform pages have MUI-styled ones.
 */
import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" style={{ maxWidth: 480, margin: "0 auto", padding: "96px 16px", textAlign: "center", fontFamily: '"Vazirmatn Variable", Vazirmatn, Tahoma, sans-serif', color: "#1f2937" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, margin: "0 0 12px" }}>صفحه پیدا نشد</h1>
      <p style={{ margin: "0 0 16px", color: "#4b5563", lineHeight: 1.9 }}>آدرس واردشده وجود ندارد.</p>
      <Link href="/" style={{ color: "#4338ca", fontWeight: 600, textDecoration: "underline", display: "inline-block", padding: "8px 0" }}>بازگشت به صفحه اصلی</Link>
    </main>
  );
}
