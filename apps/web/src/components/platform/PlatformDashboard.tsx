"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { AnalyticsRange } from "@store-builder/shared/modules/analytics/analytics";
import { TrendChart } from "@/components/charts/Charts";
import { ChartCard, Kpi } from "@/components/charts/KpiCard";
import { fa, fullDayLabel } from "@/components/charts/format";
import { TextLink } from "@/components/NextLinks";
import { toman } from "@/components/orders/labels";
import { getDashboard, type PlatformDashboard as Dash } from "@/client/platform-api";

const RANGES: { days: AnalyticsRange; label: string }[] = [
  { days: 7, label: "۷ روز" },
  { days: 30, label: "۳۰ روز" },
  { days: 90, label: "۹۰ روز" },
];
const COLORS = { revenue: "#4f46e5", stores: "#16a34a", users: "#0f766e", tickets: "#d97706" } as const;

function Tile({ label, value, href, testId, hint }: { label: string; value: string; href?: string; testId: string; hint?: string }) {
  return (
    <Paper variant="outlined" data-testid={testId} sx={{ p: 2, borderRadius: 3 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography component="p" sx={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
      {href && <Box><TextLink href={href} underline="always" sx={{ fontSize: 13 }}>مشاهده</TextLink></Box>}
    </Paper>
  );
}

/** The super admin's real dashboard: the platform's numbers today, and per day for 7 / 30 / 90 days with the change against the period before. */
export default function PlatformDashboard() {
  const [days, setDays] = useState<AnalyticsRange>(30);
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getDashboard(days).then((d) => live && (setData(d), setError(null))).catch(() => live && setError("بارگذاری داشبورد ممکن نشد."));
    return () => {
      live = false;
    };
  }, [days]);
  const ready = data && data.days === days ? data : null;
  const f = ready?.figures;
  const t = ready?.totals;
  const col = (k: "revenue" | "newStores" | "newUsers" | "tickets") => ready!.series.map((d) => ({ day: d.day, value: d[k] }));
  const vals = (k: "revenue" | "newStores" | "newUsers" | "tickets" | "purchases") => ready!.series.map((d) => d[k]);

  return (
    <Box sx={{ display: "grid", gap: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography component="h1" variant="h5" sx={{ fontWeight: 800 }}>داشبورد پلتفرم</Typography>
          <Typography variant="body2" color="text.secondary">{ready ? `از ${fullDayLabel(ready.from)} تا ${fullDayLabel(ready.to)}` : "درآمد، فروشگاه‌ها، کاربران و پشتیبانی در یک نگاه"}</Typography>
        </Box>
        <ToggleButtonGroup exclusive size="small" value={days} onChange={(_, v: AnalyticsRange | null) => v && setDays(v)} aria-label="بازهٔ نمودارها" color="primary">
          {RANGES.map((r) => <ToggleButton key={r.days} value={r.days} data-testid={`range-${r.days}`} sx={{ px: 2 }}>{r.label}</ToggleButton>)}
        </ToggleButtonGroup>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {!ready && !error && <Box role="status" aria-label="در حال بارگذاری" sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={132} />)}</Box>}

      {ready && f && t && (
        <>
          <Box component="section" aria-label="وضعیت امروز" sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
            <Tile testId="tile-open-tickets" label="درخواست‌های بی‌پاسخ" value={fa(f.openTickets)} href="/platform/tickets" hint={f.answeredTickets ? `${fa(f.answeredTickets)} پاسخ‌داده‌شده` : undefined} />
            <Tile testId="tile-subscriptions" label="اشتراک‌های فعال" value={fa(f.activeSubscriptions)} hint={f.expiringSoon ? `${fa(f.expiringSoon)} تا ۷ روز دیگر تمام می‌شود` : "هیچ‌کدام در هفتهٔ آینده تمام نمی‌شود"} />
            <Tile testId="tile-wallets" label="اعتبار کیف پول‌ها" value={toman(f.walletOutstandingToman)} hint="بدهی پلتفرم به فروشگاه‌ها (هدیهٔ دعوت و تنظیم‌ها)" />
            <Tile testId="tile-stores" label="فروشگاه‌ها" value={fa(f.stores)} href="/platform/stores" hint={`${fa(f.publishedStores)} منتشرشده${f.suspendedStores ? ` · ${fa(f.suspendedStores)} معلق` : ""}`} />
          </Box>

          <Box component="section" aria-label="شاخص‌های دوره" sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
            <Kpi testId="kpi-revenue" title="درآمد دریافتی" value={toman(t.current.revenue)} sub={`${fa(t.current.purchases)} خرید ثبت‌شده`} current={t.current.revenue} previous={t.previous.revenue} series={vals("revenue")} color={COLORS.revenue} />
            <Kpi testId="kpi-stores" title="فروشگاه تازه" value={fa(t.current.newStores)} current={t.current.newStores} previous={t.previous.newStores} series={vals("newStores")} color={COLORS.stores} />
            <Kpi testId="kpi-users" title="کاربر تازه" value={fa(t.current.newUsers)} sub={`از ${fa(f.users)} کاربر`} current={t.current.newUsers} previous={t.previous.newUsers} series={vals("newUsers")} color={COLORS.users} />
            <Kpi testId="kpi-tickets" title="درخواست پشتیبانی تازه" value={fa(t.current.tickets)} current={t.current.tickets} previous={t.previous.tickets} series={vals("tickets")} color={COLORS.tickets} />
          </Box>

          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" } }}>
            <ChartCard testId="chart-revenue" title="درآمد روزانه (تومان)">
              <TrendChart kind="bar" color={COLORS.revenue} label="درآمد" points={col("revenue")} format={toman} summary={`درآمد دریافتی روزانه در ${fa(days)} روز گذشته؛ جمع ${toman(t.current.revenue)} در ${fa(t.current.purchases)} خرید`} />
            </ChartCard>
            <ChartCard testId="chart-stores" title="فروشگاه‌های تازه">
              <TrendChart kind="bar" color={COLORS.stores} label="فروشگاه تازه" points={col("newStores")} summary={`فروشگاه تازهٔ روزانه در ${fa(days)} روز گذشته؛ جمع ${fa(t.current.newStores)} فروشگاه`} />
            </ChartCard>
            <ChartCard testId="chart-users" title="کاربران تازه">
              <TrendChart kind="line" color={COLORS.users} label="کاربر تازه" points={col("newUsers")} summary={`کاربر تازهٔ روزانه در ${fa(days)} روز گذشته؛ جمع ${fa(t.current.newUsers)} نفر`} />
            </ChartCard>
            <ChartCard testId="chart-tickets" title="درخواست‌های پشتیبانی">
              <TrendChart kind="bar" color={COLORS.tickets} label="درخواست تازه" points={col("tickets")} summary={`درخواست پشتیبانی تازهٔ روزانه در ${fa(days)} روز گذشته؛ جمع ${fa(t.current.tickets)} درخواست`} />
            </ChartCard>
          </Box>
        </>
      )}
    </Box>
  );
}
