"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { getBilling, type StoreBillingDto } from "@/client/api";
import { TextLink } from "@/components/NextLinks";
import { date, failText, toman } from "@/components/orders/labels";

const fa = (n: number) => n.toLocaleString("fa-IR");
const day = (iso: string) => new Date(iso).toLocaleDateString("fa-IR", { dateStyle: "medium" });

/** The store's subscription: what is running, the plans on sale, and what was paid. Buying is done with the platform's support (no payment gateway yet). */
export default function BillingView({ storeId }: { storeId: string }) {
  const [b, setB] = useState<StoreBillingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getBilling(storeId).then((r) => live && setB(r)).catch((e) => live && setError(failText(e)));
    return () => {
      live = false;
    };
  }, [storeId]);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!b) return <Skeleton variant="rounded" height={160} />;
  const s = b.state;
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>اشتراک</Typography>
        <Typography variant="body2" color="text.secondary">اشتراک فروشگاه شما و پلن‌های موجود. خرید و تمدید فعلاً با هماهنگی پشتیبانی انجام می‌شود.</Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} data-testid="subscription-card">
        {s.kind === "none" && <Typography>هنوز اشتراکی برای این فروشگاه ثبت نشده است.</Typography>}
        {b.subscription && s.kind !== "none" && (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{b.subscription.planName}</Typography>
              <Chip size="small" color={s.kind === "active" ? "success" : "default"} variant={s.kind === "active" ? "filled" : "outlined"} label={s.kind === "active" ? `فعال · ${fa(s.daysLeft)} روز مانده` : "منقضی شده"} />
            </Stack>
            <Typography variant="body2" color="text.secondary">از {day(b.subscription.startsAt)} تا {day(b.subscription.endsAt)}</Typography>
          </Stack>
        )}
        {b.referralDiscountPercent > 0 && (
          <Alert severity="success" sx={{ mt: 2 }} data-testid="invite-discount">
            شما با کد معرف دعوت شده‌اید: اولین خرید اشتراک شما {fa(b.referralDiscountPercent)}٪ تخفیف دارد (خودکار اعمال می‌شود).
          </Alert>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} data-testid="limits-card" component="section" aria-labelledby="limits-h">
        <Typography id="limits-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 0.5 }}>سقف‌های فروشگاه شما</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {b.free ? "اشتراک فعالی ندارید؛ سقف‌های رایگان اعمال می‌شود. کالاها و همکاران موجود حذف نمی‌شوند، فقط افزودن تازه از سقف می‌گذرد." : "سقف‌های پلن فعلی شما."}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 1, sm: 4 }}>
          <Typography>محصولات: <strong>{fa(b.usage.products)}</strong> از {fa(b.limits.maxProducts)}</Typography>
          <Typography>همکاران و دعوت‌ها: <strong>{fa(b.usage.staff)}</strong> از {fa(b.limits.maxStaff)}</Typography>
        </Stack>
      </Paper>

      <Box component="section" aria-labelledby="plans-h">
        <Typography id="plans-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1 }}>پلن‌های موجود</Typography>
        {b.plans.length === 0 && <Typography color="text.secondary">فعلاً پلنی برای فروش تعریف نشده است.</Typography>}
        <Box component="ul" aria-label="پلن‌ها" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(auto-fill, minmax(260px, 1fr))" } }}>
          {b.plans.map((p) => (
            <Paper key={p.id} component="li" variant="outlined" data-testid="plan-card" sx={{ p: 2 }}>
              <Typography sx={{ fontWeight: 700 }}>{p.name}</Typography>
              <Typography variant="h6" component="p">{p.priceToman === 0 ? "رایگان" : toman(p.priceToman)}</Typography>
              <Typography variant="body2" color="text.secondary">برای {fa(p.durationDays)} روز · تا {fa(p.maxProducts)} محصول · {fa(p.maxStaff)} همکار</Typography>
              {p.description && <Typography variant="body2" sx={{ mt: 1, overflowWrap: "anywhere" }}>{p.description}</Typography>}
            </Paper>
          ))}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          برای خرید یا تمدید، از بخش <TextLink href={`/dashboard/stores/${storeId}/tickets`} underline="always">درخواست پشتیبانی</TextLink> پلن مورد نظر را بنویسید. پس از دریافت مبلغ، اشتراک شما فعال می‌شود و می‌توانید بخشی از مبلغ را از <TextLink href={`/dashboard/stores/${storeId}/wallet`} underline="always">کیف پول</TextLink> پرداخت کنید.
        </Typography>
      </Box>

      <Box component="section" aria-labelledby="purchases-h">
        <Typography id="purchases-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1 }}>خریدهای ثبت‌شده</Typography>
        {b.purchases.length === 0 ? (
          <Typography color="text.secondary">هنوز خریدی ثبت نشده است.</Typography>
        ) : (
          <Paper variant="outlined" sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label="خریدهای ثبت‌شده">
              <TableHead>
                <TableRow>
                  <TableCell scope="col">تاریخ</TableCell>
                  <TableCell scope="col">پلن</TableCell>
                  <TableCell scope="col">قیمت</TableCell>
                  <TableCell scope="col">تخفیف</TableCell>
                  <TableCell scope="col">از کیف پول</TableCell>
                  <TableCell scope="col">پرداخت‌شده</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {b.purchases.map((p) => (
                  <TableRow key={p.id} data-testid="purchase-row">
                    <TableCell component="th" scope="row">{date(p.createdAt)}</TableCell>
                    <TableCell>{p.planName}</TableCell>
                    <TableCell>{toman(p.priceToman)}</TableCell>
                    <TableCell>{p.discountToman ? toman(p.discountToman) : "—"}</TableCell>
                    <TableCell>{p.walletUsedToman ? toman(p.walletUsedToman) : "—"}</TableCell>
                    <TableCell>{toman(p.cashToman)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
      </Box>
    </Stack>
  );
}
