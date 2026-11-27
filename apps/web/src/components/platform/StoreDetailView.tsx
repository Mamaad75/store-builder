"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getStoreDetail, type PlatformStoreDetail } from "@/client/platform-api";
import { TextLink } from "@/components/NextLinks";
import { date, toman } from "@/components/orders/labels";

const fa = (n: number) => n.toLocaleString("fa-IR");
const STATUS: Record<string, string> = { DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده" };

function Fact({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography component="p" data-testid={testId} sx={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
    </Paper>
  );
}

/** One store for the operator: owner, state, theme, subscription, wallet, and plain counts. Order values and customers' data are deliberately not shown. */
export default function StoreDetailView({ storeId }: { storeId: string }) {
  const [s, setS] = useState<PlatformStoreDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getStoreDetail(storeId).then((r) => live && setS(r)).catch((e) => live && setError(e instanceof Error && e.name === "NotFoundError" ? "این فروشگاه پیدا نشد." : "بارگذاری ممکن نشد."));
    return () => {
      live = false;
    };
  }, [storeId]);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!s) return <Skeleton variant="rounded" height={200} />;
  const c = s.counts;
  return (
    <Stack spacing={2.5}>
      <TextLink href="/platform/stores" underline="hover">→ فروشگاه‌ها</TextLink>
      <Box>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography component="h1" variant="h5" sx={{ fontWeight: 800 }}>{s.name}</Typography>
          <Chip size="small" variant="outlined" label={STATUS[s.status] ?? s.status} />
          {s.suspended && <Chip size="small" color="error" label="معلق توسط پلتفرم" />}
        </Stack>
        <Typography color="text.secondary" data-testid="store-summary">
          مالک: <TextLink href={`/platform/users/${s.owner.id}`} underline="always"><bdi dir="ltr">{s.owner.username}</bdi></TextLink> ({s.owner.name}) · ساخته‌شده {date(s.createdAt)}{s.publishedAt ? ` · آخرین انتشار ${date(s.publishedAt)}` : ""}
          {s.subdomain ? <> · آدرس: <bdi dir="ltr">{s.subdomain}</bdi></> : null} · قالب <bdi dir="ltr">{s.theme.key}</bdi> نسخهٔ {fa(s.theme.version)}
        </Typography>
        <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
          <TextLink href={`/platform/stores/${s.id}/billing`} underline="always">مالی و اشتراک</TextLink>
          <TextLink href="/platform/stores" underline="always">تعلیق از فهرست فروشگاه‌ها</TextLink>
        </Stack>
      </Box>

      <Box component="section" aria-label="شمارش‌ها" sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
        <Fact testId="fact-products" label="محصول فعال" value={fa(c.productsActive)} />
        <Fact label="محصول پیش‌نویس و بایگانی" value={fa(c.productsOther)} />
        <Fact testId="fact-orders" label="سفارش‌ها (کل)" value={fa(c.orders)} />
        <Fact label="سفارش ۳۰ روز اخیر" value={fa(c.ordersLast30Days)} />
        <Fact label="مشتری‌ها" value={fa(c.customers)} />
        <Fact label="اعضای تیم" value={fa(c.members)} />
        <Fact testId="fact-reviews" label="نظر در انتظار تأیید" value={fa(c.pendingReviews)} />
        <Fact label="مقالهٔ منتشرشده" value={fa(c.publishedPosts)} />
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }} data-testid="store-finance">
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 0.5 }}>اشتراک و کیف پول</Typography>
        <Typography>{s.subscription ? `${s.subscription.planName} تا ${date(s.subscription.endsAt)}` : "اشتراکی ثبت نشده است."}</Typography>
        <Typography color="text.secondary">اعتبار کیف پول: {toman(s.walletBalanceToman)}{s.referredByPending ? " · تخفیف دعوت اولین خرید در انتظار است" : ""}</Typography>
        <Typography color="text.secondary">درخواست پشتیبانی باز: {fa(c.openTickets)}{c.openTickets ? <> · <TextLink href="/platform/tickets" underline="always">صندوق پشتیبانی</TextLink></> : ""}</Typography>
      </Paper>
    </Stack>
  );
}
