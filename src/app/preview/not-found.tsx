import s from "./preview.module.css";

/** Identical for missing stores, foreign stores and unknown storefront paths. */
export default function PreviewNotFound() {
  return (
    <main className={s.screen}>
      <div>
        <h1>صفحه پیدا نشد</h1>
        <p>آدرس واردشده وجود ندارد.</p>
        <a href="/dashboard">رفتن به داشبورد</a>
      </div>
    </main>
  );
}
