"use client";

import s from "./preview.module.css";

export default function PreviewError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={s.screen} role="alert">
      <div>
        <h1>پیش‌نمایش بارگذاری نشد</h1>
        <p>مشکلی پیش آمد. اطلاعات فروشگاه شما تغییری نکرده است.</p>
        <button type="button" onClick={reset}>
          تلاش دوباره
        </button>
      </div>
    </main>
  );
}
