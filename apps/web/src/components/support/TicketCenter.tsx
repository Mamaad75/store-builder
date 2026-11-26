"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { BODY_MAX, MAX_OPEN_TICKETS, SUBJECT_MAX } from "@store-builder/shared/modules/support/tickets";
import { getTickets, openTicket, type TicketDto } from "@/client/api";
import { TextLink } from "@/components/NextLinks";
import { date, failText } from "@/components/orders/labels";
import { StatusChip } from "./TicketThread";

/** The merchant's support requests: the list (newest activity first) and the form to open a new one. The thread has its own page. */
export default function TicketCenter({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<TicketDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ subject?: string; body?: string }>({});

  const load = useCallback(() => getTickets(storeId).then(setRows).catch((e) => setError(failText(e))), [storeId]);
  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setFieldError({});
    try {
      await openTicket(storeId, { subject, body });
      setSubject("");
      setBody("");
      await load();
    } catch (err) {
      const fe = err instanceof Error && err.name === "ValidationError" ? ((err as Error & { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {}) : null;
      if (fe) setFieldError({ subject: fe.subject?.[0], body: fe.body?.[0] });
      else setFormError(failText(err));
    } finally {
      setBusy(false);
    }
  }

  const openCount = rows?.filter((t) => t.status !== "CLOSED").length ?? 0;
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>درخواست پشتیبانی</Typography>
        <Typography variant="body2" color="text.secondary">
          مشکل یا پرسش خود را برای تیم پلتفرم بنویسید. پاسخ در همین صفحه نمایش داده می‌شود. حداکثر {MAX_OPEN_TICKETS.toLocaleString("fa-IR")} درخواست باز می‌توانید داشته باشید.
        </Typography>
      </Box>

      <Paper variant="outlined" component="form" onSubmit={submit} noValidate sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1.5 }}>درخواست تازه</Typography>
        {formError && <Alert severity="error" role="alert" sx={{ mb: 1.5 }}>{formError}</Alert>}
        <Stack spacing={2}>
          <TextField label="موضوع" value={subject} onChange={(e) => setSubject(e.target.value)} required fullWidth error={Boolean(fieldError.subject)} helperText={fieldError.subject} slotProps={{ htmlInput: { maxLength: SUBJECT_MAX } }} />
          <TextField label="شرح مشکل یا پرسش" value={body} onChange={(e) => setBody(e.target.value)} required multiline minRows={4} fullWidth error={Boolean(fieldError.body)} helperText={fieldError.body ?? `${body.length.toLocaleString("fa-IR")} از ${BODY_MAX.toLocaleString("fa-IR")}`} slotProps={{ htmlInput: { maxLength: BODY_MAX } }} />
          <Box>
            <Button type="submit" variant="contained" disabled={busy || !subject.trim() || !body.trim() || openCount >= MAX_OPEN_TICKETS}>{busy ? "در حال ارسال…" : "ثبت درخواست"}</Button>
            {openCount >= MAX_OPEN_TICKETS && <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>به سقف درخواست‌های باز رسیده‌اید؛ یکی را ببندید.</Typography>}
          </Box>
        </Stack>
      </Paper>

      <Box component="section" aria-labelledby="my-tickets-h">
        <Typography id="my-tickets-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1 }}>درخواست‌های شما</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {!rows && !error && <Skeleton variant="rounded" height={72} />}
        {rows && rows.length === 0 && <Typography color="text.secondary">هنوز درخواستی ثبت نکرده‌اید.</Typography>}
        {rows && rows.length > 0 && (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
            {rows.map((t) => (
              <Paper key={t.id} component="li" variant="outlined" data-testid="ticket-row" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <Box sx={{ minWidth: 0 }}>
                  <TextLink href={`/dashboard/stores/${storeId}/tickets/${t.id}`} underline="hover" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{t.subject}</TextLink>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    آخرین پیام: {date(t.lastMessageAt)} · {t.messageCount.toLocaleString("fa-IR")} پیام
                  </Typography>
                </Box>
                <StatusChip status={t.status} />
              </Paper>
            ))}
          </Box>
        )}
      </Box>
    </Stack>
  );
}
