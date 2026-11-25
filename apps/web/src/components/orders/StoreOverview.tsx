"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { TextLink } from "@/components/NextLinks";
import { getOverview, type StoreOverview as Overview } from "@/client/api";
import { failText, toman } from "./labels";

const fa = (n: number) => n.toLocaleString("fa-IR");
const PERIOD_LABELS = { today: "امروز", days7: "۷ روز اخیر", days30: "۳۰ روز اخیر" } as const;

/**
 * M2: the store overview on the store's dashboard home. The numbers and their rules come from the API (shared/modules/orders/overview.ts);
 * this only displays them. Owner and manager only: for a role without `orders.view` the section is simply not shown.
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
  const noOrders = !!data && data.periods.days30.orders.count === 0 && Object.values(data.pending).every((a) => a.count === 0) && data.actions.toConfirm + data.actions.toShip === 0;
  const orders = `/dashboard/stores/${encodeURIComponent(storeId)}/orders`;

  return (
    <Paper variant="outlined" component="section" aria-labelledby="overview-title" sx={{ p: { xs: 2, md: 3 } }}>
      <Typography id="overview-title" variant="h6" component="h2" sx={{ fontWeight: 700, mb: 2 }}>نمای کلی فروشگاه</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {!data && !error && <Typography color="text.secondary" role="status">در حال بارگذاری…</Typography>}
      {data && (
        <Stack spacing={3}>
          <Box>
            <Typography component="h3" sx={{ fontWeight: 700, mb: 1 }}>کارهای در انتظار</Typography>
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 0, listStyle: "none" }}>
              <li><TextLink href={`${orders}?review=receipt`}>رسید کارت‌به‌کارت منتظر بررسی: {fa(data.actions.receiptsToReview)}</TextLink></li>
              <li><TextLink href={`${orders}?status=PLACED`}>سفارش منتظر تأیید: {fa(data.actions.toConfirm)}</TextLink></li>
              <li><TextLink href={`${orders}?status=CONFIRMED`}>سفارش منتظر ارسال: {fa(data.actions.toShip)}</TextLink></li>
            </Stack>
          </Box>

          <Box>
            <Typography id="overview-sales" component="h3" sx={{ fontWeight: 700, mb: 1 }}>فروش (بر اساس تاریخ ثبت سفارش، به وقت تهران)</Typography>
            {noOrders && <Typography color="text.secondary" sx={{ mb: 1 }}>هنوز سفارشی ثبت نشده است. سفارش‌ها پس از ثبت در این بخش نمایش داده می‌شوند.</Typography>}
            {/* Scrolls sideways on narrow screens: focusable and named so keyboard users can scroll it (WCAG 2.1.1). */}
            <Box sx={{ overflowX: "auto" }} tabIndex={0} role="region" aria-labelledby="overview-sales">
            <Table size="small" aria-label="فروش در بازه‌های زمانی" sx={{ "& th, & td": { px: { xs: 0.75, sm: 2 } } }}>
              <TableHead>
                <TableRow>
                  <TableCell>بازه</TableCell>
                  <TableCell>تعداد</TableCell>
                  <TableCell>ارزش سفارش‌ها</TableCell>
                  <TableCell>درآمد دریافتی</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(Object.keys(PERIOD_LABELS) as (keyof typeof PERIOD_LABELS)[]).map((p) => (
                  <TableRow key={p} data-testid={`overview-${p}`}>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{PERIOD_LABELS[p]}</TableCell>
                    <TableCell>{fa(data.periods[p].orders.count)}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{toman(data.periods[p].orders.total)}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{toman(data.periods[p].paid.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              درآمد هر سفارش در روز <strong>ثبت سفارش</strong> حساب می‌شود، نه روز دریافت پول. «امروز» از ساعت ۰۰:۰۰ به وقت تهران است و «۷ روز اخیر»
              امروز و ۶ روز پیش از آن را شامل می‌شود.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              درآمد دریافت‌شده: پرداخت در محل پس از «تحویل‌شده»، پرداخت اینترنتی پس از تأیید درگاه، کارت‌به‌کارت پس از تأیید رسید. سفارش‌های لغوشده و
              منقضی‌شده حساب نمی‌شوند؛ اگر سفارشی پس از پرداخت لغو شود، مبلغ و بازپرداخت آن در این گزارش نیست.
            </Typography>
          </Box>

          <Box>
            <Typography component="h3" sx={{ fontWeight: 700, mb: 1 }}>پرداخت‌های در انتظار</Typography>
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 0, listStyle: "none" }}>
              <li>پرداخت در محل (هنوز تحویل نشده): {fa(data.pending.codToCollect.count)} سفارش — {toman(data.pending.codToCollect.total)}</li>
              <li>پرداخت اینترنتی انجام‌نشده: {fa(data.pending.onlineAwaiting.count)} سفارش — {toman(data.pending.onlineAwaiting.total)}</li>
              <li>کارت‌به‌کارت، رسید در انتظار بررسی: {fa(data.pending.cardReceiptInReview.count)} سفارش — {toman(data.pending.cardReceiptInReview.total)}</li>
              <li>کارت‌به‌کارت، در انتظار رسید مشتری: {fa(data.pending.cardAwaitingCustomer.count)} سفارش — {toman(data.pending.cardAwaitingCustomer.total)}</li>
            </Stack>
          </Box>

          <Box>
            <Typography component="h3" sx={{ fontWeight: 700, mb: 1 }}>موجودی کم (حداکثر {fa(data.lowStock.threshold)} عدد)</Typography>
            {data.lowStock.items.length === 0 ? (
              <Typography color="text.secondary">محصول فعالی با موجودی کم ندارید.</Typography>
            ) : (
              <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 0, listStyle: "none" }} aria-label="محصولات با موجودی کم">
                {data.lowStock.items.map((p) => (
                  <li key={p.productId}>
                    <TextLink href={`/dashboard/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(p.productId)}`}>{p.name}</TextLink>: {fa(p.stock)} عدد
                  </li>
                ))}
                {data.lowStock.total > data.lowStock.items.length && <li>و {fa(data.lowStock.total - data.lowStock.items.length)} محصول دیگر</li>}
              </Stack>
            )}
          </Box>
        </Stack>
      )}
    </Paper>
  );
}
