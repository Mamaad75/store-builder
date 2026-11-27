"use client";

import { useEffect, useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getReferral, redeemReferral, type ReferralInfoDto } from "@/client/api";
import { date, failText, toman } from "@/components/orders/labels";

const fa = (n: number) => n.toLocaleString("fa-IR");

/** Invite friends: the store's code and link, what each invited store earned, and (for an invited store) entering the code that invited it. */
export default function ReferralView({ storeId }: { storeId: string }) {
  const [r, setR] = useState<ReferralInfoDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // only used once the data has loaded (after hydration), so reading the window here cannot differ from the server render
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));

  const load = () => getReferral(storeId).then(setR).catch((e) => setError(failText(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  async function copy(what: "code" | "link", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null); // the text stays selectable on the page
    }
  }
  async function redeem(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setCodeError(null);
    try {
      await redeemReferral(storeId, code);
      setCode("");
      await load();
    } catch (err) {
      setCodeError(failText(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!r) return <Skeleton variant="rounded" height={160} />;
  const link = `${origin}/register?ref=${r.code}`;
  const rewarded = r.referrals.filter((x) => x.status === "REWARDED");
  const earned = rewarded.reduce((t, x) => t + x.rewardToman, 0);
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>دعوت از دوستان</Typography>
        <Typography variant="body2" color="text.secondary">
          هر فروشگاهی را که با کد شما بیاید دعوت کرده‌اید: شما {fa(r.percent)}٪ مبلغ اولین خرید اشتراک او را به‌صورت اعتبار هدیه در کیف پول می‌گیرید، و او برای راه‌اندازی فروشگاهش {fa(r.percent)}٪ تخفیف ویژه دارد.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="body2" color="text.secondary">کد معرف فروشگاه شما</Typography>
        <Typography variant="h4" component="p" dir="ltr" data-testid="referral-code" sx={{ fontWeight: 800, letterSpacing: 4, textAlign: "start", my: 1 }}>{r.code}</Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mb: 2 }}>
          <Button variant="outlined" size="small" onClick={() => copy("code", r.code)}>کپی کد</Button>
          <Button variant="outlined" size="small" onClick={() => copy("link", link)}>کپی پیوند دعوت</Button>
          <Typography role="status" variant="body2" color="success.dark" sx={{ alignSelf: "center" }}>{copied === "code" ? "کد کپی شد." : copied === "link" ? "پیوند کپی شد." : ""}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" component="p">پیوند دعوت:</Typography>
        <Typography variant="body2" dir="ltr" sx={{ overflowWrap: "anywhere", textAlign: "start" }}>{link}</Typography>
      </Paper>

      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2, minWidth: 180 }}>
          <Typography variant="body2" color="text.secondary">فروشگاه‌های دعوت‌شده</Typography>
          <Typography variant="h5" component="p" data-testid="referral-count">{fa(r.referrals.length)}</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, minWidth: 180 }}>
          <Typography variant="body2" color="text.secondary">اعتبار دریافتی</Typography>
          <Typography variant="h5" component="p" data-testid="referral-earned">{toman(earned)}</Typography>
        </Paper>
      </Stack>

      {r.referrals.length > 0 && (
        <Box component="ul" aria-label="فروشگاه‌های دعوت‌شده" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
          {r.referrals.map((x, i) => (
            <Paper key={x.id} component="li" variant="outlined" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <Typography>دعوت شمارهٔ {fa(r.referrals.length - i)} · {date(x.createdAt)}</Typography>
              {x.status === "REWARDED" ? <Chip size="small" color="success" label={`اعتبار ${toman(x.rewardToman)}`} /> : <Chip size="small" variant="outlined" label="در انتظار اولین خرید" />}
            </Paper>
          ))}
        </Box>
      )}

      <Box component="section" aria-labelledby="invited-h">
        <Typography id="invited-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1 }}>شما با کد معرف آمده‌اید؟</Typography>
        {r.referredBy ? (
          <Alert severity="success" data-testid="invited-notice">
            {r.referredBy.status === "PENDING" ? `کد معرف ثبت شده است؛ اولین خرید اشتراک شما ${fa(r.percent)}٪ تخفیف دارد.` : "تخفیف دعوت روی اولین خرید شما اعمال شد."}
          </Alert>
        ) : (
          <Box component="form" onSubmit={redeem} noValidate>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "flex-start" } }}>
              <TextField label="کد معرف" value={code} onChange={(e) => setCode(e.target.value)} error={Boolean(codeError)} helperText={codeError ?? `کد ۸ حرفی که دوستتان به شما داده؛ پیش از اولین خرید اشتراک ثبت کنید.`} slotProps={{ htmlInput: { dir: "ltr", maxLength: 40, autoCapitalize: "characters" } }} sx={{ maxWidth: 320 }} />
              <Button type="submit" variant="contained" disabled={busy || !code.trim()} sx={{ mt: { sm: 0.5 } }}>ثبت کد</Button>
            </Stack>
          </Box>
        )}
      </Box>
    </Stack>
  );
}
