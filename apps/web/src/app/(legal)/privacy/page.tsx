import type { Metadata } from "next";
import Typography from "@mui/material/Typography";

export const metadata: Metadata = { title: "حریم خصوصی" };

export default function PrivacyPage() {
  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        حریم خصوصی
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
  ["اطلاعاتی که نگهداری می‌کنیم", "نام، ایمیل و رمز عبور (فقط به‌صورت رمزنگاری‌شده و غیرقابل بازگشت) برای حساب کاربری، و محتوایی که برای فروشگاه خود ثبت می‌کنید."],
  ["کاربرد اطلاعات", "اطلاعات حساب فقط برای ورود، امنیت حساب و ارتباطات ضروری مانند بازیابی رمز عبور استفاده می‌شود."],
  ["اشتراک‌گذاری", "اطلاعات حساب شما برای تبلیغات فروخته یا به‌صورت عمومی منتشر نمی‌شود. محتوای فروشگاهِ منتشرشده برای همه قابل مشاهده است."],
  ["نشست‌ها و کوکی‌ها", "برای نگه‌داشتن ورود شما از یک کوکی نشست استفاده می‌شود. می‌توانید از صفحه حساب کاربری از همه دستگاه‌ها خارج شوید."],
  ["حذف اطلاعات", "با حذف فروشگاه، محتوای آن حذف می‌شود. برای درخواست‌های مربوط به حساب کاربری با پشتیبانی تماس بگیرید."],
];
