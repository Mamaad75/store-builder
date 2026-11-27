"use client";

import { useEffect, useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { TOPUP_MAX_TOMAN, TOPUP_MIN_TOMAN, WALLET_KIND_LABELS } from "@store-builder/shared/modules/billing/billing";
import { digitsToAscii } from "@store-builder/shared/lib/text";
import { getWallet, topUpWallet, type WalletDto } from "@/client/api";
import { goToGateway } from "@/client/shop";
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
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [topupError, setTopupError] = useState<string | null>(null);
  async function topup(e: FormEvent) {
    e.preventDefault();
    const n = Number(digitsToAscii(amount).replace(/[,،٬\s]/g, ""));
    if (!Number.isInteger(n) || n < TOPUP_MIN_TOMAN || n > TOPUP_MAX_TOMAN) {
      setTopupError(`مبلغ را بین ${TOPUP_MIN_TOMAN.toLocaleString("fa-IR")} و ${TOPUP_MAX_TOMAN.toLocaleString("fa-IR")} تومان بنویسید.`);
      return;
    }
    setBusy(true);
    setTopupError(null);
    try {
      const r = await topUpWallet(storeId, n);
      if (!goToGateway(r.url)) {
        setTopupError("نشانی درگاه معتبر نبود؛ دوباره تلاش کنید.");
        setBusy(false);
      }
    } catch (err) {
      setTopupError(failText(err));
      setBusy(false);
    }
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!w) return <Skeleton variant="rounded" height={160} />;
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>کیف پول</Typography>
        <Typography variant="body2" color="text.secondary">
          اعتبار شما برای خرید و تمدید اشتراک؛ از دعوت دوستان، هدیهٔ پشتیبانی یا شارژ از درگاه. اعتبار قابل برداشت نیست. برای دریافت اعتبار بیشتر، <TextLink href={`/dashboard/stores/${storeId}/referrals`} underline="always">دوستانتان را دعوت کنید</TextLink>.
        </Typography>
      </Box>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="body2" color="text.secondary">موجودی</Typography>
        <Typography variant="h4" component="p" data-testid="wallet-balance" sx={{ fontWeight: 800 }}>{toman(w.balanceToman)}</Typography>
      </Paper>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} component="section" aria-labelledby="topup-h" data-testid="topup-card">
        <Typography id="topup-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1 }}>شارژ کیف پول</Typography>
        {!w.gatewayReady ? (
          <Typography color="text.secondary">شارژ آنلاین فعلاً فعال نیست.</Typography>
        ) : (
          <Box component="form" onSubmit={topup} noValidate>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "flex-start" } }}>
              <TextField label="مبلغ شارژ (تومان)" value={amount} onChange={(e) => setAmount(e.target.value)} slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr" } }} helperText={`از ${TOPUP_MIN_TOMAN.toLocaleString("fa-IR")} تا ${TOPUP_MAX_TOMAN.toLocaleString("fa-IR")} تومان`} error={!!topupError} sx={{ minWidth: 240 }} />
              <Button type="submit" variant="contained" disabled={busy} sx={{ minHeight: 56 }}>رفتن به درگاه پرداخت</Button>
            </Stack>
            {topupError && <Alert severity="error" role="alert" sx={{ mt: 1.5 }}>{topupError}</Alert>}
          </Box>
        )}
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
