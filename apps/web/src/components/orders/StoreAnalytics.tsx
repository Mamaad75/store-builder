"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { getAnalytics, type StoreAnalytics as Analytics } from "@/client/api";
import { type AnalyticsRange } from "@store-builder/shared/modules/analytics/analytics";
import { TrendChart } from "@/components/charts/Charts";
import { ChartCard, Kpi } from "@/components/charts/KpiCard";
import { compact, fa, fullDayLabel } from "@/components/charts/format";
import { failText, toman } from "./labels";

const RANGES: { days: AnalyticsRange; label: string }[] = [
  { days: 7, label: "۷ روز" },
  { days: 30, label: "۳۰ روز" },
  { days: 90, label: "۹۰ روز" },
];
const COLORS = { sales: "#4f46e5", orders: "#16a34a", visits: "#0f766e", visitors: "#d97706", customers: "#9333ea" } as const;

type Series = Analytics["series"];

const col = (s: Series, k: "views" | "visitors" | "orders" | "sales" | "customers") => s.map((d) => ({ day: d.day, value: d[k] }));
const peak = (s: Series, k: "views" | "orders" | "sales" | "customers") => s.reduce((a, d) => (d[k] > a[k] ? d : a), s[0]!);

/**
 * The store's trend charts: sales, orders, visits and new customers per day for 7 / 30 / 90 days, with the change against the previous
 * period. Every figure comes from the API (rules in shared/modules/analytics); this only draws them. Owner and manager only (the figures
 * include order values): for other roles the section is simply not shown.
 */
export default function StoreAnalytics({ storeId }: { storeId: string }) {
  const [days, setDays] = useState<AnalyticsRange>(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getAnalytics(storeId, days)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof Error && e.name === "PermissionDeniedError") setHidden(true);
        else setError(failText(e));
      });
    return () => {
      live = false;
    };
  }, [storeId, days]);

  if (hidden) return null;
  const ready = data && data.days === days ? data : null;
  const t = ready?.totals;
  const trackedFrom = ready?.trackingSince ?? null;
  const partial = ready && trackedFrom && trackedFrom > ready.from;

  return (
    <Paper variant="outlined" component="section" aria-labelledby="trends-h" data-testid="store-analytics" sx={{ p: { xs: 2, md: 3 }, borderRadius: 4, bgcolor: "#fafbff" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap", mb: 2.5 }}>
        <Box>
          <Typography id="trends-h" variant="h6" component="h2" sx={{ fontWeight: 800 }}>روند فروشگاه</Typography>
          <Typography variant="body2" color="text.secondary">
            {ready ? `از ${fullDayLabel(ready.from)} تا ${fullDayLabel(ready.to)}` : "فروش، سفارش، بازدید و مشتریان در یک نگاه"}
          </Typography>
        </Box>
        <ToggleButtonGroup exclusive size="small" value={days} onChange={(_, v: AnalyticsRange | null) => v && setDays(v)} aria-label="بازهٔ نمودارها" color="primary">
          {RANGES.map((r) => (
            <ToggleButton key={r.days} value={r.days} data-testid={`range-${r.days}`} sx={{ px: 2 }}>{r.label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!ready && !error && (
        <Box role="status" aria-label="در حال بارگذاری نمودارها" sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={132} />)}
        </Box>
      )}

      {ready && t && (
        <Box sx={{ display: "grid", gap: 2.5 }}>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
            <Kpi testId="kpi-sales" title="فروش" value={toman(t.current.sales)} current={t.current.sales} previous={t.previous.sales} series={ready.series.map((d) => d.sales)} color={COLORS.sales} />
            <Kpi testId="kpi-orders" title="سفارش" value={fa(t.current.orders)} current={t.current.orders} previous={t.previous.orders} series={ready.series.map((d) => d.orders)} color={COLORS.orders} />
            <Kpi
              testId="kpi-visits"
              title="بازدید صفحه"
              value={fa(t.current.views)}
              sub={`${fa(t.current.visitors)} بازدیدکننده${ready.conversionPercent !== null ? ` · نرخ تبدیل ${fa(ready.conversionPercent)}٪` : ""}`}
              current={t.current.views}
              previous={t.previous.views}
              series={ready.series.map((d) => d.views)}
              color={COLORS.visits}
            />
            <Kpi testId="kpi-customers" title="مشتری جدید" value={fa(t.current.customers)} current={t.current.customers} previous={t.previous.customers} series={ready.series.map((d) => d.customers)} color={COLORS.customers} />
          </Box>

          {!trackedFrom && (
            <Alert severity="info" data-testid="visits-not-started">ثبت بازدید فروشگاه از اولین بازدید پس از فعال‌شدن این بخش شروع می‌شود؛ تا آن زمان نمودار بازدید خالی است.</Alert>
          )}
          {partial && <Alert severity="info" data-testid="visits-partial">بازدیدها از {fullDayLabel(trackedFrom!)} ثبت شده‌اند؛ پیش از آن تاریخ، صفر نشان داده می‌شود.</Alert>}

          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" } }}>
            <ChartCard testId="chart-sales" title="فروش روزانه (تومان)">
              <TrendChart
                kind="bar" color={COLORS.sales} label="فروش" points={col(ready.series, "sales")} format={toman}
                summary={`فروش روزانه در ${fa(days)} روز گذشته؛ جمع ${toman(t.current.sales)}${t.current.sales > 0 ? `؛ بیشترین فروش ${fullDayLabel(peak(ready.series, "sales").day)} با ${toman(peak(ready.series, "sales").sales)}` : ""}`}
              />
            </ChartCard>
            <ChartCard testId="chart-orders" title="سفارش‌ها">
              <TrendChart
                kind="bar" color={COLORS.orders} label="سفارش" points={col(ready.series, "orders")}
                summary={`تعداد سفارش روزانه در ${fa(days)} روز گذشته؛ جمع ${fa(t.current.orders)} سفارش`}
              />
            </ChartCard>
            <ChartCard testId="chart-visits" title="بازدید">
              <TrendChart
                kind="line" color={COLORS.visits} color2={COLORS.visitors} label="بازدید صفحه" label2="بازدیدکننده"
                points={ready.series.map((d) => ({ day: d.day, value: d.views, value2: d.visitors }))}
                summary={`بازدید صفحه و بازدیدکننده در ${fa(days)} روز گذشته؛ جمع ${fa(t.current.views)} بازدید صفحه و ${fa(t.current.visitors)} بازدیدکننده`}
              />
            </ChartCard>
            <ChartCard testId="chart-customers" title="مشتریان جدید">
              <TrendChart
                kind="bar" color={COLORS.customers} label="مشتری جدید" points={col(ready.series, "customers")}
                summary={`مشتری جدید روزانه در ${fa(days)} روز گذشته؛ جمع ${fa(t.current.customers)} نفر`}
              />
            </ChartCard>
          </Box>

          <Typography variant="caption" color="text.secondary" component="p">
            فروش و سفارش: سفارش‌های ثبت‌شده تا تحویل‌شده با همهٔ روش‌های پرداخت، به‌صورت ناخالص (بدون کسر بازپرداخت). بازدیدکننده: تعداد افراد متفاوت در هر روز، جمع‌شده روی روزها؛ ربات‌ها و کسانی که ردیابی را غیرفعال کرده‌اند شمرده نمی‌شوند و هویت کسی ثبت نمی‌شود. روزها به وقت تهران هستند. بیشترین مقدار محور: {compact(Math.max(...ready.series.map((d) => d.sales)))} تومان.
          </Typography>
        </Box>
      )}
    </Paper>
  );
}
