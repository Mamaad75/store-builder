import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { TextLink } from "@/components/NextLinks";
import { requireUser } from "@/modules/auth/session";
import { getStore } from "@/gateway/stores";
import { NotFoundError } from "@store-builder/shared/modules/stores/errors";
import { SUPPORT, supportChannels } from "@store-builder/shared/lib/support";

export const metadata: Metadata = { title: "راهنما و پشتیبانی" };

/** Answers to what a new merchant asks first, written from what the panel can actually do today. */
const FAQ: { q: string; a: string }[] = [
  { q: "فروشگاهم را چطور منتشر کنم؟", a: "در «داشبورد»، فهرست «آماده‌سازی فروشگاه برای فروش» نشان می‌دهد چه چیزی کم است: حداقل یک محصول فعال، یک روش ارسال، یک روش پرداخت و آدرس فروشگاه. بعد از کامل‌شدن، در «انتشار» روی انتشار بزنید." },
  { q: "چرا تغییرم در فروشگاه دیده نمی‌شود؟", a: "تغییر محصولات، صفحه‌ها و ظاهر در پیش‌نویس می‌ماند تا در «انتشار» منتشرش کنید. روش‌های ارسال، موجودی و کدهای تخفیف بدون انتشار و همان لحظه اعمال می‌شوند. با «پیش‌نمایش پیش‌نویس» بالای صفحه می‌توانید قبل از انتشار ببینید." },
  { q: "پرداخت در محل، کارت‌به‌کارت و پرداخت اینترنتی را چطور فعال کنم؟", a: "پرداخت در محل را در «روش‌های ارسال» روی همان روش روشن می‌کنید. کارت‌به‌کارت و درگاه اینترنتی در «روش‌های پرداخت» تنظیم می‌شوند و فقط مالک فروشگاه می‌تواند کارت بانکی یا کلید درگاه را ثبت کند. پرداخت اینترنتی فقط وقتی کار می‌کند که درگاه برای پلتفرم فعال باشد." },
  { q: "کد رهگیری مرسوله را کجا بنویسم؟", a: "در صفحهٔ هر سفارش: بعد از «تأیید سفارش»، هنگام «ثبت ارسال» می‌توانید کد پست یا باربری را بنویسید. بعداً هم از همان صفحه قابل اصلاح است. خریدار آن را در صفحهٔ پیگیری سفارش خودش می‌بیند." },
  { q: "برای محصول رنگ و سایز چه کنم؟", a: "در صفحهٔ ویرایش محصول، بخش «تنوع‌ها»: نام ویژگی‌ها (مثلاً رنگ، سایز) و مقدارها را بنویسید، «ساخت ترکیب‌ها» را بزنید و قیمت و موجودی هر ترکیب را وارد کنید. محصول با تنوع، کمترین قیمت و جمع موجودی را نشان می‌دهد." },
  { q: "قیمت کالا را به دلار یا طلا وصل کنم؟", a: "در صفحهٔ ویرایش محصول (یا برای هر تنوع) «اتصال قیمت». قیمت با هر به‌روزرسانی نرخ خودکار محاسبه می‌شود. این کار فقط برای مالک و مدیر است و نرخ‌ها را پلتفرم وارد می‌کند." },
  { q: "همکار یا کارمند اضافه کنم؟", a: "از «تیم» (فقط مالک): نام کاربری همکار را بنویسید و نقش بدهید. همکار باید قبلاً ثبت‌نام کرده باشد و دعوت را در «فروشگاه‌های من» بپذیرد. «مدیر» تقریباً همه‌چیز را می‌بیند جز تیم و کارت بانکی؛ «کارمند» فقط محصولات و صفحه‌ها. هر کاری در «گزارش فعالیت‌ها» ثبت می‌شود." },
];

export default async function SupportPage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await requireUser();
  const { storeId } = await params;
  let store;
  try {
    store = await getStore(storeId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const channels = supportChannels();
  return (
    <Box sx={{ display: "grid", gap: 3 }}>
      <Box>
        <Typography variant="h5" component="h2" sx={{ fontWeight: 800 }}>راهنما و پشتیبانی</Typography>
        <Typography color="text.secondary">پاسخ سؤال‌های رایج، و راه تماس با پشتیبانی اگر به جواب نرسیدید.</Typography>
      </Box>

      <Paper variant="outlined" component="section" aria-labelledby="faq-h" sx={{ p: { xs: 1, md: 2 }, borderRadius: 3 }}>
        <Typography id="faq-h" component="h3" sx={{ fontWeight: 700, px: 1.5, pt: 1, pb: 1 }}>سؤال‌های رایج</Typography>
        {FAQ.map((f, i) => (
          <Accordion key={i} disableGutters elevation={0} square sx={{ "&:before": { display: "none" }, borderTop: i ? "1px solid" : 0, borderColor: "divider" }}>
            <AccordionSummary expandIcon={<ExpandMoreRounded />} aria-controls={`faq-${i}-c`} id={`faq-${i}-h`}>
              <Typography sx={{ fontWeight: 600 }}>{f.q}</Typography>
            </AccordionSummary>
            <AccordionDetails id={`faq-${i}-c`}>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 2 }}>{f.a}</Typography>
            </AccordionDetails>
          </Accordion>
        ))}
      </Paper>

      <Paper variant="outlined" component="section" aria-labelledby="contact-h" data-testid="support-contact" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
        <Typography id="contact-h" component="h3" sx={{ fontWeight: 700, mb: 1.5 }}>تماس با پشتیبانی</Typography>
        {channels.length === 0 ? (
          <Typography color="text.secondary">راه‌های تماس پشتیبانی به‌زودی در همین‌جا اضافه می‌شود.</Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
            {channels.map((c) => (
              <li key={c.kind}>
                {c.label}: <TextLink href={c.href} {...(c.kind === "telegram" ? { target: "_blank", rel: "noopener" } : {})}><span dir="ltr">{c.value}</span></TextLink>
              </li>
            ))}
          </Box>
        )}
        {SUPPORT.hours && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>ساعت پاسخ‌گویی: {SUPPORT.hours}</Typography>}
        <Typography variant="body2" sx={{ mt: 2, fontWeight: 600 }}>این اطلاعات را همراه پیام خود بفرستید تا سریع‌تر پیگیری شود:</Typography>
        <Box component="dl" data-testid="support-info" sx={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 0.5, columnGap: 2, m: 0, mt: 0.5, p: 1.5, borderRadius: 2, bgcolor: "#f3f4fb", fontSize: 14, "& dd": { minWidth: 0, overflowWrap: "anywhere" } }}>
          <dt>فروشگاه</dt><dd style={{ margin: 0 }}>{store.name}</dd>
          <dt>شناسهٔ فروشگاه</dt><dd style={{ margin: 0 }} dir="ltr"><code>{store.id}</code></dd>
          <dt>نام کاربری شما</dt><dd style={{ margin: 0 }} dir="ltr"><code>{user.username}</code></dd>
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>رمز عبور خود را هرگز برای کسی نفرستید؛ پشتیبانی هیچ‌وقت آن را نمی‌خواهد.</Typography>
      </Paper>
    </Box>
  );
}
