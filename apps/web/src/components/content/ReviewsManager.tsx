"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { REPLY_MAX, REVIEW_STATUSES, REVIEW_STATUS_LABELS, type ReviewStatus } from "@store-builder/shared/modules/reviews/reviews";
import { getReviews, replyReview, setReviewStatus, type StoreReviewDto } from "@/client/api";
import { date, failText } from "@/components/orders/labels";

const PAGE = 50;
const fa = (n: number) => n.toLocaleString("fa-IR");
/** The default orange chip (white on #ed6c02) is 3.1:1; a waiting state uses a dark text on a light orange instead. */
const WAITING_SX = { bgcolor: "#ffe0b2", color: "#4e2600" } as const;
const COLOR: Record<ReviewStatus, "warning" | "success" | "default"> = { PENDING: "warning", APPROVED: "success", REJECTED: "default" };

function ReviewCard({ storeId, r, onChanged }: { storeId: string; r: StoreReviewDto; onChanged: () => void }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState(r.reply ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      setReplying(false);
      onChanged();
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper component="li" variant="outlined" data-testid="review-card" sx={{ p: 2, listStyle: "none" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", mb: 0.5 }}>
        <Typography component="span" sx={{ fontWeight: 700 }}>{r.productName}</Typography>
        <Chip size="small" color={COLOR[r.status]} variant={r.status === "REJECTED" ? "outlined" : "filled"} label={REVIEW_STATUS_LABELS[r.status]} sx={r.status === "PENDING" ? WAITING_SX : undefined} />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {r.authorName} · امتیاز {fa(r.rating)} از {fa(5)} · {date(r.createdAt)}
      </Typography>
      <Typography sx={{ mt: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.body}</Typography>
      {r.reply && !replying && (
        <Typography variant="body2" sx={{ mt: 1, pl: 1.5, borderLeft: 3, borderColor: "divider", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          <strong>پاسخ شما: </strong>{r.reply}
        </Typography>
      )}
      {error && <Alert severity="error" role="alert" sx={{ mt: 1 }}>{error}</Alert>}
      {replying && (
        <Box sx={{ mt: 1.5 }}>
          <TextField label="پاسخ عمومی به این نظر" value={text} onChange={(e) => setText(e.target.value)} multiline minRows={2} fullWidth slotProps={{ htmlInput: { maxLength: REPLY_MAX } }} helperText="پاسخ در صفحهٔ محصول زیر نظر دیده می‌شود. متن خالی، پاسخ را برمی‌دارد." />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button variant="contained" disabled={busy} onClick={() => run(() => replyReview(storeId, r.id, text))}>ذخیرهٔ پاسخ</Button>
            <Button disabled={busy} onClick={() => { setReplying(false); setText(r.reply ?? ""); }}>انصراف</Button>
          </Stack>
        </Box>
      )}
      {!replying && (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
          {r.status !== "APPROVED" && <Button size="small" variant="contained" disabled={busy} onClick={() => run(() => setReviewStatus(storeId, r.id, "APPROVED"))} aria-label={`تأیید نظر ${r.authorName} دربارهٔ ${r.productName}`}>تأیید</Button>}
          {r.status !== "REJECTED" && <Button size="small" color="error" disabled={busy} onClick={() => run(() => setReviewStatus(storeId, r.id, "REJECTED"))} aria-label={`رد نظر ${r.authorName} دربارهٔ ${r.productName}`}>رد</Button>}
          {r.status === "APPROVED" && <Button size="small" disabled={busy} onClick={() => setReplying(true)} aria-label={`پاسخ به نظر ${r.authorName}`}>{r.reply ? "ویرایش پاسخ" : "پاسخ"}</Button>}
        </Stack>
      )}
    </Paper>
  );
}

/** The moderation queue of product reviews: a new review waits here until it is approved (then it shows on the product page) or rejected. */
export default function ReviewsManager({ storeId }: { storeId: string }) {
  const [status, setStatus] = useState<ReviewStatus | "all">("PENDING");
  const [rows, setRows] = useState<StoreReviewDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const load = useCallback(
    () => getReviews(storeId, { status: status === "all" ? undefined : status, limit: String(PAGE) }).then((r) => { setRows(r); setMore(r.length === PAGE); setError(null); }).catch((e) => setError(failText(e))),
    [storeId, status],
  );
  useEffect(() => {
    load();
  }, [load]);
  async function loadMore() {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    try {
      const next = await getReviews(storeId, { status: status === "all" ? undefined : status, before: last.createdAt, limit: String(PAGE) });
      setRows([...(rows ?? []), ...next]);
      setMore(next.length === PAGE);
    } catch (e) {
      setError(failText(e));
    }
  }
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>نظرات خریداران</Typography>
        <Typography variant="body2" color="text.secondary">نظر تازه تا تأیید شما در فروشگاه دیده نمی‌شود. خریدار با حساب خودش در فروشگاه نظر می‌دهد؛ شمارهٔ تلفنش هرگز نمایش داده نمی‌شود.</Typography>
      </Box>
      <Tabs value={status} onChange={(_, v) => { setRows(null); setStatus(v); }} aria-label="وضعیت نظرها" variant="scrollable" scrollButtons="auto">
        {REVIEW_STATUSES.map((s) => <Tab key={s} value={s} label={REVIEW_STATUS_LABELS[s]} />)}
        <Tab value="all" label="همه" />
      </Tabs>
      {error && <Alert severity="error">{error}</Alert>}
      {!rows && !error && <Skeleton variant="rounded" height={96} />}
      {rows && rows.length === 0 && <Typography color="text.secondary">نظری در این وضعیت نیست.</Typography>}
      {rows && rows.length > 0 && (
        <Box component="ul" aria-label="نظرها" sx={{ m: 0, p: 0, display: "grid", gap: 1.5 }}>
          {rows.map((r) => <ReviewCard key={r.id} storeId={storeId} r={r} onChanged={load} />)}
        </Box>
      )}
      {more && <Box><Button variant="outlined" onClick={loadMore}>نمایش نظرهای قدیمی‌تر</Button></Box>}
    </Stack>
  );
}
