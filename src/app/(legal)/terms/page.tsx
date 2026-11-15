import type { Metadata } from "next";
import Typography from "@mui/material/Typography";

export const metadata: Metadata = { title: "شرایط استفاده" };

export default function TermsPage() {
  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        شرایط استفاده
      </Typography>
      {SECTIONS.map(([h, t]) => (
        <section key={h}>
          <Typography variant="h6" component="h2" sx={{ mt: 3, fontWeight: 700 }}>
            {h}
          </Typography>
          <Typography color="text.secondary">{t}</Typography>
        </section>
      ))}
    </>
  );
}

const SECTIONS: [string, string][] = [
  ["پذیرش شرایط", "با ساخت حساب و استفاده از این سرویس، این شرایط را می‌پذیرید. اگر با آن موافق نیستید، از سرویس استفاده نکنید."],
  ["حساب کاربری", "مسئولیت حفظ رمز عبور و فعالیت‌های انجام‌شده با حساب خود بر عهده شماست. اطلاعات واردشده باید درست باشد."],
  ["محتوای فروشگاه", "محتوایی که برای فروشگاه خود ثبت و منتشر می‌کنید (متن، تصویر، محصول) مسئولیتش با شماست و باید قانونی باشد و حق دیگران را نقض نکند."],
  ["انتشار و توقف", "می‌توانید فروشگاه خود را منتشر یا لغو انتشار کنید. در صورت نقض این شرایط، دسترسی به سرویس ممکن است محدود شود."],
  ["تغییر شرایط", "این شرایط ممکن است به‌روزرسانی شود. ادامه استفاده از سرویس به معنی پذیرش نسخه جدید است."],
];
