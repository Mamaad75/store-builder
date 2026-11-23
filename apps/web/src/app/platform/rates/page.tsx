import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { ManualRateForm, RateDecision } from "@/components/platform/PlatformForms";
import { TextLink } from "@/components/NextLinks";
import { getPlatformRates } from "@/gateway/platform";

const LABEL = { USD: "دلار (بازار آزاد، فروش)", GOLD18: "طلای ۱۸ عیار (هر گرم)" } as const;
const STATUS = { APPLIED: "اعمال شده", PENDING: "منتظر تأیید", REJECTED: "رد / جایگزین شده" } as const;
const PROVIDER = { off: "خاموش", manual: "ورود دستی", navasan: "نوسان (هر ساعت)" } as const;
const toman = (n: number) => `${n.toLocaleString("fa-IR")} تومان`;
const when = (iso: string) => new Date(iso).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
const hidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

/** Phase 3.2b (D32b-1): current rates, rates held for confirmation, manual entry and recent history. */
export default async function PlatformRatesPage() {
  const r = await getPlatformRates();
  return (
    <>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
        نرخ طلا و دلار
      </Typography>
      <Typography sx={{ color: "text.secondary", mb: 3 }}>
        قیمت محصولاتی که فروشنده‌ها به دلار یا طلا متصل کرده‌اند با این نرخ‌ها حساب می‌شود. منبع فعلی: {PROVIDER[r.provider]} (<TextLink href="/platform/settings">تغییر در تنظیمات</TextLink>).
      </Typography>

      {r.pending.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }} role="status">
          {r.pending.length.toLocaleString("fa-IR")} نرخ منتظر تأیید شماست. تا تأیید نشود، قیمت‌ها روی آخرین نرخ اعمال‌شده می‌مانند.
        </Alert>
      )}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3 }}>
        {(["USD", "GOLD18"] as const).map((code) => {
          const c = r.current[code];
          return (
            <Card key={code} variant="outlined" component="section" aria-label={LABEL[code]} sx={{ flex: 1 }}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
                  <Typography component="h2" sx={{ fontWeight: 800 }}>
                    {LABEL[code]}
                  </Typography>
                  {c && <Chip size="small" color={c.stale ? "warning" : "success"} label={c.stale ? "کهنه" : "به‌روز"} />}
                </Stack>
                {c ? (
                  <>
                    <Typography sx={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{toman(c.rateToman)}</Typography>
                    <Typography sx={{ color: "text.secondary", fontSize: 14 }}>اعمال: {when(c.appliedAt)}</Typography>
                  </>
                ) : (
                  <Typography sx={{ color: "text.secondary" }}>هنوز نرخی ثبت نشده است؛ فروشنده‌ها نمی‌توانند به این مبنا متصل کنند.</Typography>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      {r.pending.length > 0 && (
        <Card variant="outlined" component="section" aria-label="نرخ‌های منتظر تأیید" sx={{ mb: 3 }}>
          <CardContent>
            <Typography component="h2" variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
              منتظر تأیید
            </Typography>
            <Stack spacing={2}>
              {r.pending.map((p) => {
                const cur = r.current[p.code];
                const change = cur ? ((p.rateToman - cur.rateToman) / cur.rateToman) * 100 : null;
                return (
                  <Box key={p.id} sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
                    <Typography sx={{ fontWeight: 700 }}>
                      {LABEL[p.code]}: {toman(p.rateToman)}
                    </Typography>
                    <Typography sx={{ color: "text.secondary", fontSize: 14, mb: 1 }}>
                      {change === null ? "اولین نرخ خودکار" : `تغییر نسبت به نرخ فعلی: ${change > 0 ? "+" : ""}${change.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪`} · منبع: {p.source} · زمان سرویس: {when(p.observedAt)}
                    </Typography>
                    <RateDecision id={p.id} label={`نرخ ${LABEL[p.code]} = ${toman(p.rateToman)}`} />
                  </Box>
                );
              })}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Card variant="outlined" component="section" aria-label="ثبت دستی نرخ" sx={{ mb: 3 }}>
        <CardContent>
          <Typography component="h2" variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
            ثبت دستی نرخ
          </Typography>
          <Typography sx={{ color: "text.secondary", mb: 2 }}>نرخ دستی بلافاصله اعمال می‌شود و همه‌ی قیمت‌های متصل همان لحظه به‌روز می‌شوند. در گزارش فعالیت ثبت می‌شود.</Typography>
          <ManualRateForm />
        </CardContent>
      </Card>

      <Typography component="h2" variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
        تاریخچه‌ی اخیر
      </Typography>
      <TableContainer tabIndex={0} role="region" aria-label="تاریخچه‌ی نرخ‌ها" sx={{ border: 1, borderColor: "divider" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell scope="col">مبنا</TableCell>
              <TableCell scope="col">نرخ</TableCell>
              <TableCell scope="col">وضعیت</TableCell>
              <TableCell scope="col">منبع</TableCell>
              <TableCell scope="col">ثبت</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {r.history.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>هنوز نرخی ثبت نشده است.</TableCell>
              </TableRow>
            )}
            {r.history.map((h) => (
              <TableRow key={h.id}>
                <TableCell component="th" scope="row">{LABEL[h.code]}</TableCell>
                <TableCell sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{toman(h.rateToman)}</TableCell>
                <TableCell>{STATUS[h.status]}</TableCell>
                <TableCell dir="ltr">{h.source}</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  {when(h.createdAt)}
                  <Box component="span" sx={hidden}>
                    {h.decidedById ? " (با تصمیم مدیر)" : ""}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
