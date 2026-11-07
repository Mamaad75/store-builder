import s from "./preview.module.css";

/**
 * Shown above a candidate-theme preview (`?theme=`): this is the owner's draft rendered with ANOTHER theme. Nothing is
 * applied, saved or published; the store keeps its own theme until the owner confirms the switch in the dashboard.
 */
export default function CandidateBanner({
  storeId,
  candidate,
  dormantCount = 0,
  unavailable = false,
}: {
  storeId: string;
  candidate?: { key: string; name: string };
  dormantCount?: number;
  unavailable?: boolean;
}) {
  const back = `/dashboard/stores/${encodeURIComponent(storeId)}/appearance`;
  if (unavailable) {
    return (
      <main className={s.screen} data-testid="preview-candidate-unavailable">
        <div>
          <h1>این قالب برای پیش‌نمایش در دسترس نیست</h1>
          <p>قالب انتخاب‌شده وجود ندارد یا فعال نیست. فروشگاه شما تغییری نکرده است.</p>
          <a href={back}>بازگشت به قالب‌ها</a>
        </div>
      </main>
    );
  }
  return (
    <aside className={s.banner} role="region" aria-label="پیش‌نمایش قالب پیشنهادی" data-testid="preview-candidate-banner">
      <div className={s.inner}>
        <span>
          <span className={s.tag}>پیش‌نمایش قالب «{candidate?.name}»</span> — این فقط یک نمایش آزمایشی است؛ قالب فروشگاه تغییر نکرده و چیزی ذخیره یا منتشر نشده است.
        </span>
        <a href={back} data-testid="preview-candidate-back">
          بازگشت و بررسی سازگاری
        </a>
      </div>
      {dormantCount > 0 && (
        <ul className={s.notes}>
          <li data-testid="preview-candidate-dormant">{dormantCount.toLocaleString("fa-IR")} بخش در این قالب نمایش داده نمی‌شود (در صورت تغییر قالب، داده‌های آن حفظ می‌شود).</li>
        </ul>
      )}
    </aside>
  );
}
