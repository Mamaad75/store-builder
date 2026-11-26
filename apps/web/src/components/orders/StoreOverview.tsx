"use client";

import { useEffect, useState } from "react";
import CheckCircleOutlineRounded from "@mui/icons-material/CheckCircleOutlineRounded";
import LocalShippingOutlined from "@mui/icons-material/LocalShippingOutlined";
import PaymentsOutlined from "@mui/icons-material/PaymentsOutlined";
import TaskAltRounded from "@mui/icons-material/TaskAltRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { TextLink } from "@/components/NextLinks";
import { Donut, type DonutSlice } from "@/components/charts/Charts";
import { compact } from "@/components/charts/format";
import { getOverview, type StoreOverview as Overview } from "@/client/api";
import { failText, toman } from "./labels";

const fa = (n: number) => n.toLocaleString("fa-IR");
const PERIODS = [
  { key: "today", label: "امروز" },
  { key: "days7", label: "۷ روز اخیر" },
  { key: "days30", label: "۳۰ روز اخیر" },
] as const;
const PAID = "#16a34a";
const UNPAID = "#c7d2fe";

function ActionTile({ href, icon, title, count, color, testId }: { href: string; icon: React.ReactNode; title: string; count: number; color: string; testId: string }) {
  return (
    <Paper
      component={TextLink}
      href={href}
      variant="outlined"
      data-testid={testId}
      underline="none"
      sx={{ p: 2, borderRadius: 3, display: "flex", alignItems: "center", gap: 1.5, color: "text.primary", transition: "box-shadow .15s", "&:hover": { boxShadow: 2 }, "&:focus-visible": { outline: "3px solid #4f46e5", outlineOffset: 2 } }}
    >
      <Box aria-hidden sx={{ width: 44, height: 44, borderRadius: 2.5, display: "grid", placeItems: "center", color, bgcolor: `${color}1a`, flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="span" sx={{ display: "block", fontSize: 26, fontWeight: 800, lineHeight: 1.2, color: count > 0 ? color : "text.secondary" }}>{fa(count)}</Typography>
        <Typography component="span" variant="body2" color="text.secondary">{title}</Typography>
      </Box>
    </Paper>
  );
}

function Card({ title, id, children, testId }: { title: string; id: string; children: React.ReactNode; testId?: string }) {
  return (
    <Paper variant="outlined" component="section" aria-labelledby={id} data-testid={testId} sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3, minWidth: 0 }}>
      <Typography id={id} component="h3" sx={{ fontWeight: 700, mb: 2 }}>{title}</Typography>
      {children}
    </Paper>
  );
}

/**
 * The store overview on the store dashboard: what needs doing now, sales and money received per period, money still expected and products
 * running low. The numbers and their rules come from the API (shared/modules/orders/overview.ts); this only draws them, as tiles, bars
 * and a ring with the same figures written out as text. Owner and manager only: for a role without `orders.view` it is simply not shown.
 */
export default function StoreOverview({ storeId }: { storeId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getOverview(storeId)
      .then((o) => live && setData(o))
      .catch((e) => {
        if (!live) return;
        if (e instanceof Error && e.name === "PermissionDeniedError") setHidden(true);
        else setError(failText(e));
      });
    return () => {
      live = false;
    };
  }, [storeId]);

  if (hidden) return null;
  const orders = `/dashboard/stores/${encodeURIComponent(storeId)}/orders`;
  const noOrders = !!data && data.periods.days30.orders.count === 0 && Object.values(data.pending).every((a) => a.count === 0) && data.actions.toConfirm + data.actions.toShip === 0;
  const pending: (DonutSlice & { count: number })[] = data
    ? [
        { key: "cod", label: "پرداخت در محل (هنوز تحویل نشده)", value: data.pending.codToCollect.total, count: data.pending.codToCollect.count, color: "#4f46e5" },
        { key: "online", label: "پرداخت اینترنتی انجام‌نشده", value: data.pending.onlineAwaiting.total, count: data.pending.onlineAwaiting.count, color: "#0891b2" },
        { key: "review", label: "کارت‌به‌کارت، رسید در انتظار بررسی", value: data.pending.cardReceiptInReview.total, count: data.pending.cardReceiptInReview.count, color: "#d97706" },
        { key: "card", label: "کارت‌به‌کارت، در انتظار رسید مشتری", value: data.pending.cardAwaitingCustomer.total, count: data.pending.cardAwaitingCustomer.count, color: "#9333ea" },
      ]
    : [];
  const pendingTotal = pending.reduce((n, s) => n + s.value, 0);

  return (
    <Paper variant="outlined" component="section" aria-labelledby="overview-title" data-testid="store-overview" sx={{ p: { xs: 2, md: 3 }, borderRadius: 4, bgcolor: "#fafbff" }}>
      <Typography id="overview-title" variant="h6" component="h2" sx={{ fontWeight: 800 }}>نمای کلی فروشگاه</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>کارهای در انتظار، فروش، پولی که هنوز نرسیده و موجودی کم</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {!data && !error && (
        <Box role="status" aria-label="در حال بارگذاری نمای کلی" sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" } }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={84} />)}
        </Box>
      )}

      {data && (
        <Box sx={{ display: "grid", gap: 2.5 }}>
          <Box component="ul" aria-label="کارهای در انتظار" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" } }}>
            <li><ActionTile testId="action-receipts" href={`${orders}?review=receipt`} icon={<PaymentsOutlined />} title="رسید کارت‌به‌کارت منتظر بررسی" count={data.actions.receiptsToReview} color="#d97706" /></li>
            <li><ActionTile testId="action-confirm" href={`${orders}?status=PLACED`} icon={<CheckCircleOutlineRounded />} title="سفارش منتظر تأیید" count={data.actions.toConfirm} color="#4f46e5" /></li>
            <li><ActionTile testId="action-ship" href={`${orders}?status=CONFIRMED`} icon={<LocalShippingOutlined />} title="سفارش منتظر ارسال" count={data.actions.toShip} color="#0891b2" /></li>
          </Box>

          {noOrders && (
            <Alert severity="info" icon={<TaskAltRounded />}>هنوز سفارشی ثبت نشده است. سفارش‌ها پس از ثبت در این بخش نمایش داده می‌شوند.</Alert>
          )}

          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" } }}>
            <Card id="overview-sales" title="فروش و درآمد دریافتی" testId="overview-sales-card">
              <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 2.5 }}>
                {PERIODS.map(({ key, label }) => {
                  const p = data.periods[key];
                  const share = p.orders.total > 0 ? Math.min(100, Math.round((p.paid.total / p.orders.total) * 100)) : 0;
                  return (
                    <li key={key} data-testid={`overview-${key}`}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
                        <Typography component="span" sx={{ fontWeight: 700 }}>{label}</Typography>
                        <Typography component="span" variant="body2" color="text.secondary">{fa(p.orders.count)} سفارش</Typography>
                      </Box>
                      <Typography component="p" data-testid={`overview-${key}-value`} sx={{ fontSize: { xs: 20, md: 22 }, fontWeight: 800, lineHeight: 1.5 }}>{toman(p.orders.total)}</Typography>
                      <Box aria-hidden sx={{ height: 10, borderRadius: 5, bgcolor: UNPAID, overflow: "hidden", display: "flex" }}>
                        <Box sx={{ width: `${share}%`, bgcolor: PAID, borderRadius: 5 }} />
                      </Box>
                      <Typography component="p" variant="body2" color="text.secondary" data-testid={`overview-${key}-paid`} sx={{ mt: 0.75 }}>
                        <Box component="span" aria-hidden sx={{ color: PAID }}>●</Box> دریافت‌شده: <strong>{toman(p.paid.total)}</strong>
                        {p.orders.total > 0 && <> ({fa(share)}٪ از ارزش سفارش‌ها)</>}
                      </Typography>
                    </li>
                  );
                })}
              </Box>
              <Typography variant="body2" sx={{ mt: 2, fontWeight: 600 }} data-testid="overview-refund-note">
                این ارقام ناخالص است: بازپرداخت‌های انجام‌شده هنوز از درآمد کسر نمی‌شود، چون ثبت بازپرداخت هنوز در سامانه وجود ندارد.
              </Typography>
              <Box component="details" sx={{ mt: 1 }}>
                <Typography component="summary" variant="body2" color="text.secondary" sx={{ cursor: "pointer", width: "fit-content" }}>نحوهٔ محاسبه</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  درآمد هر سفارش در روز <strong>ثبت سفارش</strong> حساب می‌شود، نه روز دریافت پول. «امروز» از ساعت ۰۰:۰۰ به وقت تهران است و «۷ روز اخیر» امروز و ۶ روز پیش از آن را شامل می‌شود.
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  درآمد دریافتی: پرداخت در محل پس از «تحویل‌شده»، پرداخت اینترنتی پس از تأیید درگاه، کارت‌به‌کارت پس از تأیید رسید. سفارش‌های لغوشده و منقضی‌شده حساب نمی‌شوند؛ اگر سفارشی پس از پرداخت لغو شود، مبلغ و بازپرداخت آن در این گزارش نیست.
                </Typography>
              </Box>
            </Card>

            <Card id="overview-pending" title="پرداخت‌های در انتظار" testId="overview-pending-card">
              <Box sx={{ display: "flex", gap: 2.5, alignItems: "center", flexDirection: { xs: "column", sm: "row", lg: "column" } }}>
                <Donut slices={pending} size={150}>
                  <Box>
                    <Typography component="span" aria-hidden sx={{ display: "block", fontWeight: 800, fontSize: 18, lineHeight: 1.3 }}>{compact(pendingTotal)}</Typography>
                    <Typography component="span" aria-hidden variant="caption" color="text.secondary">تومان</Typography>
                  </Box>
                </Donut>
                <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.25, width: "100%" }}>
                  {pending.map((s) => (
                    <li key={s.key} data-testid={`pending-${s.key}`}>
                      <Typography variant="body2" component="p"><Box component="span" aria-hidden sx={{ color: s.color }}>●</Box> {s.label}</Typography>
                      <Typography variant="body2" color="text.secondary" component="p" sx={{ paddingInlineStart: 2 }}>{fa(s.count)} سفارش — {toman(s.value)}</Typography>
                    </li>
                  ))}
                </Box>
              </Box>
            </Card>
          </Box>

          <Card id="overview-stock" title={`موجودی کم (حداکثر ${fa(data.lowStock.threshold)} عدد)`} testId="overview-stock-card">
            {data.lowStock.items.length === 0 ? (
              <Typography color="text.secondary">محصول فعالی با موجودی کم ندارید.</Typography>
            ) : (
              <Box component="ul" aria-label="محصولات با موجودی کم" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5 }}>
                {data.lowStock.items.map((p) => {
                  const w = Math.max(6, Math.min(100, (p.stock / Math.max(1, data.lowStock.threshold)) * 100));
                  return (
                    <li key={p.productId}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                        <Typography component="span" sx={{ flex: "1 1 180px", minWidth: 0 }}>
                          <TextLink href={`/dashboard/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(p.productId)}`}>{p.name}</TextLink>: {fa(p.stock)} عدد
                        </Typography>
                        <Box aria-hidden sx={{ flex: "1 1 120px", maxWidth: 220, height: 8, borderRadius: 4, bgcolor: "#e5e7eb", overflow: "hidden" }}>
                          <Box sx={{ width: `${w}%`, height: "100%", bgcolor: p.stock === 0 ? "#dc2626" : "#d97706", borderRadius: 4 }} />
                        </Box>
                      </Box>
                    </li>
                  );
                })}
                {data.lowStock.total > data.lowStock.items.length && <Typography component="li" variant="body2" color="text.secondary">و {fa(data.lowStock.total - data.lowStock.items.length)} محصول دیگر</Typography>}
              </Box>
            )}
          </Card>
        </Box>
      )}
    </Paper>
  );
}
