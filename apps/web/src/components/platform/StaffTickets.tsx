"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { TICKET_STATUSES, TICKET_STATUS_LABELS, type TicketStatus } from "@store-builder/shared/modules/support/tickets";
import { getStaffTicket, listStaffTickets, replyStaffTicket, setStaffTicketStatus, type StaffTicket, type StaffTicketDetail } from "@/client/platform-api";
import { TextLink } from "@/components/NextLinks";
import { date } from "@/components/orders/labels";
import TicketThread, { StatusChip } from "@/components/support/TicketThread";

const message = (e: unknown) => (e instanceof Error && e.name === "ValidationError" ? (Object.values((e as Error & { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {}).flat()[0] ?? "متن را بررسی کنید.") : "انجام نشد؛ دوباره تلاش کنید.");

/** The platform staff's inbox: every store's requests, filtered by status; the oldest waiting ones are what needs an answer. */
export function StaffTicketList() {
  const [status, setStatus] = useState<TicketStatus | "all">("OPEN");
  const [rows, setRows] = useState<StaffTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    listStaffTickets(status === "all" ? undefined : status).then((r) => live && setRows(r)).catch(() => live && setError("بارگذاری ممکن نشد."));
    return () => { live = false; };
  }, [status]);
  return (
    <Stack spacing={2}>
      <TextField select size="small" label="وضعیت" value={status} onChange={(e) => { setRows(null); setStatus(e.target.value as TicketStatus | "all"); }} sx={{ maxWidth: 240 }}>
        <MenuItem value="all">همه</MenuItem>
        {TICKET_STATUSES.map((s) => <MenuItem key={s} value={s}>{TICKET_STATUS_LABELS[s]}</MenuItem>)}
      </TextField>
      {error && <Alert severity="error">{error}</Alert>}
      {!rows && !error && <Skeleton variant="rounded" height={72} />}
      {rows && rows.length === 0 && <Typography color="text.secondary">درخواستی با این وضعیت نیست.</Typography>}
      {rows && rows.length > 0 && (
        <Box component="ul" aria-label="درخواست‌ها" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
          {rows.map((t) => (
            <Paper key={t.id} component="li" variant="outlined" data-testid="staff-ticket-row" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <Box sx={{ minWidth: 0 }}>
                <TextLink href={`/platform/tickets/${t.id}`} underline="hover" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{t.subject}</TextLink>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {t.storeName} · آخرین پیام: {date(t.lastMessageAt)} · {t.messageCount.toLocaleString("fa-IR")} پیام
                </Typography>
              </Box>
              <StatusChip status={t.status} />
            </Paper>
          ))}
        </Box>
      )}
    </Stack>
  );
}

/** One request: the conversation, the reply, and the status (close / reopen). Replying to a closed request is refused until it is reopened. */
export function StaffTicketView({ ticketId }: { ticketId: string }) {
  const [t, setT] = useState<StaffTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => getStaffTicket(ticketId).then(setT).catch((e) => setError(e instanceof Error && e.name === "NotFoundError" ? "این درخواست پیدا نشد." : "بارگذاری ممکن نشد.")), [ticketId]);
  useEffect(() => { load(); }, [load]);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!t) return <Skeleton variant="rounded" height={160} />;
  const closed = t.status === "CLOSED";
  const setTo = (s: TicketStatus) => async () => { try { await setStaffTicketStatus(ticketId, s); await load(); } catch (e) { setError(message(e)); } };
  return (
    <Stack spacing={2}>
      <TextLink href="/platform/tickets" underline="hover">→ همهٔ درخواست‌ها</TextLink>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{t.subject}</Typography>
        <StatusChip status={t.status} />
      </Stack>
      <Typography variant="body2" color="text.secondary">فروشگاه: <TextLink href="/platform/stores" underline="hover">{t.storeName}</TextLink></Typography>
      <TicketThread
        viewer="STAFF"
        messages={t.messages}
        disabledReason={closed ? "این درخواست بسته است؛ برای پاسخ، ابتدا دوباره بازش کنید." : undefined}
        onSend={async (body) => {
          try { await replyStaffTicket(ticketId, body); } catch (e) { throw new Error(message(e)); }
          await load();
        }}
        actions={closed ? <Button variant="outlined" onClick={setTo("OPEN")}>باز کردن دوباره</Button> : <Button variant="outlined" onClick={setTo("CLOSED")}>بستن درخواست</Button>}
      />
    </Stack>
  );
}
