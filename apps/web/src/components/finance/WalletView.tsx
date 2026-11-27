"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { WALLET_KIND_LABELS } from "@store-builder/shared/modules/billing/billing";
import { getWallet, type WalletDto } from "@/client/api";
import { TextLink } from "@/components/NextLinks";
import { date, failText, toman } from "@/components/orders/labels";

/** The store's gift credit: the balance and every movement. The credit pays part of a subscription purchase; it is not money that can be withdrawn. */
export default function WalletView({ storeId }: { storeId: string }) {
  const [w, setW] = useState<WalletDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getWallet(storeId).then((r) => live && setW(r)).catch((e) => live && setError(failText(e)));
    return () => {
      live = false;
    };
  }, [storeId]);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!w) return <Skeleton variant="rounded" height={160} />;
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>کیف پول</Typography>
        <Typography variant="body2" color="text.secondary">
          اعتباری که از دعوت دوستان یا هدیهٔ پشتیبانی به دست می‌آورید. هنگام خرید یا تمدید اشتراک خرج می‌شود و قابل برداشت نیست. برای دریافت اعتبار بیشتر، <TextLink href={`/dashboard/stores/${storeId}/referrals`} underline="always">دوستانتان را دعوت کنید</TextLink>.
        </Typography>
      </Box>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="body2" color="text.secondary">موجودی</Typography>
        <Typography variant="h4" component="p" data-testid="wallet-balance" sx={{ fontWeight: 800 }}>{toman(w.balanceToman)}</Typography>
      </Paper>
      <Box component="section" aria-labelledby="ledger-h">
        <Typography id="ledger-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1 }}>تراکنش‌ها</Typography>
        {w.entries.length === 0 ? (
          <Typography color="text.secondary">هنوز تراکنشی ندارید.</Typography>
        ) : (
          <Paper variant="outlined" sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label="تراکنش‌های کیف پول">
              <TableHead>
                <TableRow>
                  <TableCell scope="col">تاریخ</TableCell>
                  <TableCell scope="col">شرح</TableCell>
                  <TableCell scope="col">مبلغ</TableCell>
                  <TableCell scope="col">موجودی پس از آن</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {w.entries.map((e) => (
                  <TableRow key={e.id} data-testid="wallet-row">
                    <TableCell component="th" scope="row">{date(e.createdAt)}</TableCell>
                    <TableCell>{WALLET_KIND_LABELS[e.kind]}{e.note ? ` — ${e.note}` : ""}</TableCell>
                    <TableCell sx={{ color: e.amountToman > 0 ? "success.dark" : "error.dark", fontWeight: 700 }}>
                      <bdi>{e.amountToman > 0 ? "+" : "−"}{toman(Math.abs(e.amountToman))}</bdi>
                    </TableCell>
                    <TableCell>{toman(e.balanceAfter)}</TableCell>
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
