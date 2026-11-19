import type { StorefrontNotes } from "@/modules/storefront/build";
import s from "./preview.module.css";

/** Always shown above a draft preview so it can never be mistaken for the public storefront. */
export default function PreviewBanner({ storeId, notes }: { storeId: string; notes: StorefrontNotes }) {
  const skipped = notes.skippedSections.reduce((n, p) => n + p.issues.length, 0);
  return (
    <aside className={s.banner} role="region" aria-label="پیش‌نمایش پیش‌نویس" data-testid="preview-banner">
      <div className={s.inner}>
        <span>
          <span className={s.tag}>پیش‌نمایش پیش‌نویس</span> — این صفحه عمومی نیست و فقط شما آن را می‌بینید. چیزی منتشر نمی‌شود.
        </span>
        <a href={`/dashboard/stores/${encodeURIComponent(storeId)}/products`}>بازگشت به داشبورد</a>
      </div>
      {(notes.excludedProductCount > 0 || skipped > 0 || notes.settingsFallback || notes.dormantSectionCount > 0 || notes.invalidSpecsProductCount > 0) && (
        <ul className={s.notes}>
          {notes.excludedProductCount > 0 && (
            <li data-testid="preview-note-excluded">
              {notes.excludedProductCount.toLocaleString("fa-IR")} محصول پیش‌نویس یا بایگانی‌شده در فروشگاه نمایش داده نمی‌شود.
            </li>
          )}
          {skipped > 0 && <li>{skipped.toLocaleString("fa-IR")} بخش نامعتبر در صفحه‌ها نادیده گرفته شد (داده‌ها تغییری نکرده‌اند).</li>}
          {notes.dormantSectionCount > 0 && (
            <li data-testid="preview-note-dormant">{notes.dormantSectionCount.toLocaleString("fa-IR")} بخش غیرفعال (متعلق به قالب دیگر) در این قالب نمایش داده نمی‌شود؛ داده‌های آن حفظ شده است.</li>
          )}
          {notes.invalidSpecsProductCount > 0 && (
            <li data-testid="preview-note-invalid-specs">{notes.invalidSpecsProductCount.toLocaleString("fa-IR")} محصول مشخصات نامعتبر دارد؛ در فروشگاه بدون مشخصات نمایش داده می‌شود و داده‌های ذخیره‌شده تغییری نکرده‌اند. از ویرایش محصول می‌توانید آن را اصلاح یا پاک کنید.</li>
          )}
          {notes.settingsFallback && <li>تنظیمات فروشگاه نامعتبر بود؛ از تنظیمات پیش‌فرض قالب استفاده شد.</li>}
        </ul>
      )}
    </aside>
  );
}
