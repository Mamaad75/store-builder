"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary of every page, the storefronts included. Deliberately plain HTML and CSS: this file is bundled into every route, so it
 * must not import a UI library (MUI used to be pulled into each storefront page through here, about 50 KB of JavaScript). It shows no technical
 * detail; the digest is the only thing logged client-side, for correlation. The dashboard and platform have their own, MUI-styled boundary.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app-error]", error.digest ?? "no-digest");
  }, [error]);
  return (
    <main id="main" style={{ maxWidth: 480, margin: "0 auto", padding: "96px 16px", textAlign: "center", fontFamily: '"Vazirmatn Variable", Vazirmatn, Tahoma, sans-serif', color: "#1f2937" }}>
      <h1 data-testid="error-title" style={{ fontSize: "2rem", fontWeight: 800, margin: "0 0 12px" }}>مشکلی پیش آمد</h1>
      <p style={{ margin: "0 0 24px", color: "#4b5563", lineHeight: 1.9 }}>درخواست شما انجام نشد. دوباره تلاش کنید؛ اگر مشکل ادامه داشت، کمی بعد برگردید.</p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={reset} style={{ font: "inherit", fontWeight: 700, minHeight: 44, padding: "0 24px", border: 0, borderRadius: 8, background: "#4338ca", color: "#fff", cursor: "pointer" }}>
          تلاش دوباره
        </button>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 16px", color: "#4338ca", fontWeight: 600 }}>صفحه اصلی</Link>
      </div>
    </main>
  );
}
