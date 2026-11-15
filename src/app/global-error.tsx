"use client";

/** Last-resort boundary (errors in the root layout itself). Self-contained: no providers, no MUI. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fa" dir="rtl">
      <body style={{ fontFamily: "sans-serif", textAlign: "center", padding: "6rem 1rem" }}>
        <main id="main">
          <h1>مشکلی پیش آمد</h1>
          <p>درخواست شما انجام نشد. دوباره تلاش کنید.</p>
          <button type="button" onClick={reset}>
            تلاش دوباره
          </button>
        </main>
      </body>
    </html>
  );
}
