import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { LinkButton } from "@/components/NextLinks";
import SiteFooter from "@/components/SiteFooter";
import SkipLink from "@/components/SkipLink";
import ThemeRegistry from "@/theme/ThemeRegistry";

export const metadata: Metadata = {
  title: { absolute: "سایت‌ساز فروشگاهی | فروشگاه اینترنتی خود را بسازید" },
  description: "فروشگاه اینترنتی خود را بدون نیاز به برنامه‌نویسی بسازید، محصولاتتان را ثبت کنید و با آدرس اختصاصی منتشر کنید.",
  robots: { index: true, follow: true },
};

const FEATURES: [string, string][] = [
  ["قالب‌های آماده", "از میان قالب‌های فارسی و راست‌چین انتخاب کنید و ظاهر فروشگاه را با رنگ و فونت خودتان بسازید."],
  ["محصولات و دسته‌بندی", "محصول، قیمت، موجودی، تصویر و مشخصات را ثبت کنید و در دسته‌بندی‌ها سازمان دهید."],
  ["انتشار با آدرس اختصاصی", "فروشگاه شما با یک آدرس اختصاصی منتشر می‌شود و تا زمانی که انتشار نکنید، پیش‌نویس می‌ماند."],
  ["دیده شدن در جست‌وجو", "عنوان، توضیحات و نقشه سایت به‌صورت خودکار برای موتورهای جست‌وجو آماده می‌شود."],
];

/** Static (prerendered) landing page of the platform host. Store hosts never reach it: the proxy rewrites them to the storefront. */
export default function HomePage() {
  return (
    <ThemeRegistry>
      <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <SkipLink />
        <Container component="header" sx={{ py: 2 }}>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography sx={{ fontWeight: 800 }}>سایت‌ساز فروشگاهی</Typography>
            <Stack component="nav" aria-label="حساب کاربری" direction="row" spacing={1}>
              <LinkButton href="/login">ورود</LinkButton>
              <LinkButton href="/register" variant="contained">
                ثبت‌نام
              </LinkButton>
            </Stack>
          </Stack>
        </Container>
        <Container component="main" id="main" maxWidth="md" sx={{ py: { xs: 6, md: 10 }, flexGrow: 1 }}>
          <Stack spacing={3} sx={{ alignItems: "center", textAlign: "center" }}>
            <Typography variant="h3" component="h1" sx={{ fontWeight: 800 }}>
              فروشگاه اینترنتی خود را در چند دقیقه بسازید
            </Typography>
            <Typography variant="h6" component="p" color="text.secondary">
              بدون نیاز به برنامه‌نویسی: قالب را انتخاب کنید، محصولاتتان را ثبت کنید و فروشگاه را منتشر کنید.
            </Typography>
            <LinkButton href="/register" variant="contained" size="large">
              ساخت فروشگاه
            </LinkButton>
          </Stack>
          <Grid container spacing={2} component="section" aria-label="امکانات" sx={{ mt: 6 }}>
            {FEATURES.map(([title, text]) => (
              <Grid key={title} size={{ xs: 12, sm: 6 }}>
                <Paper variant="outlined" sx={{ p: 3, height: "100%" }}>
                  <Typography variant="h6" component="h2" gutterBottom sx={{ fontWeight: 700 }}>
                    {title}
                  </Typography>
                  <Typography color="text.secondary">{text}</Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>
        </Container>
        <SiteFooter />
      </Box>
    </ThemeRegistry>
  );
}
