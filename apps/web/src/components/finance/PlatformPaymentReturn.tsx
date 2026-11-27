"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { AUTHORITY_RE } from "@store-builder/shared/modules/billing/billing";
import { verifyPlatformPayment, type PlatformPaymentReturnDto } from "@/client/api";
import { TextLink } from "@/components/NextLinks";
import { failText, toman } from "@/components/orders/labels";
import { paymentTitle } from "./paymentLabels";

/** The buyer is back from the gateway: the server verifies the payment (the only thing that grants anything) and this page tells what happened. */
export default function PlatformPaymentReturn({ storeId, authority, status }: { storeId: string; authority: string; status: string }) {
  const valid = AUTHORITY_RE.test(authority) && (status === "OK" || status === "NOK");
  const [r, setR] = useState<PlatformPaymentReturnDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const check = useCallback(() => {
    setError(null);
    setR(null);
    setTries((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!valid) return;
    let live = true;
    verifyPlatformPayment(storeId, authority, status as "OK" | "NOK")
      .then((x) => live && setR(x))
      .catch((e) => live && setError(failText(e)));
    return () => {
      live = false;
    };
  }, [storeId, authority, status, valid, tries]);

  const back = (
    <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
      <TextLink href={`/dashboard/stores/${storeId}/billing`} underline="always">بازگشت به اشتراک‌ها</TextLink>
      <TextLink href={`/dashboard/stores/${storeId}/wallet`} underline="always">کیف پول</TextLink>
    </Stack>
  );
  if (!valid) return <Stack><Alert severity="error">نشانی بازگشت از درگاه نامعتبر است.</Alert>{back}</Stack>;
  if (error) return <Stack><Alert severity="error" role="alert">{error}</Alert>{back}</Stack>;
  if (!r) return <Skeleton variant="rounded" height={96} aria-label="در حال بررسی پرداخت" />;
  const what = paymentTitle(r.payment);
  return (
    <Stack spacing={1} data-testid="payment-return" data-outcome={r.outcome}>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>نتیجهٔ پرداخت</Typography>
      {r.outcome === "paid" && (
        <Alert severity="success" role="status">
          پرداخت {what} ({toman(r.payment.amountToman)}) انجام شد{r.payment.refId ? ` · کد پیگیری ${r.payment.refId}` : ""}.
          {r.payment.status === "LATE_CREDITED" ? " این پرداخت دیر رسید؛ مبلغ به کیف پول شما اضافه شد و می‌توانید با آن پلن را بخرید." : r.payment.purpose === "PURCHASE" ? " اشتراک شما فعال است." : " مبلغ به کیف پول شما اضافه شد."}
        </Alert>
      )}
      {r.outcome === "failed" && <Alert severity="warning" role="status">پرداخت {what} انجام نشد.{r.payment.walletHeldToman > 0 ? " اعتبار کیف پولی که برای این پرداخت کنار گذاشته شده بود برگشت داده شد." : ""} می‌توانید دوباره تلاش کنید.</Alert>}
      {r.outcome === "pending" && (
        <Alert severity="info" role="status">
          هنوز نتیجه‌ای از درگاه نرسیده است. اگر مبلغ از حسابتان کم شده، چند دقیقه صبر کنید؛ نتیجه خودکار ثبت می‌شود.
          <Button size="small" onClick={check} sx={{ marginInlineStart: 1 }}>بررسی دوباره</Button>
        </Alert>
      )}
      {back}
    </Stack>
  );
}
