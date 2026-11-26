"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { BODY_MAX, TICKET_STATUS_LABELS, type TicketStatus } from "@store-builder/shared/modules/support/tickets";
import { date } from "@/components/orders/labels";

export const STATUS_COLOR: Record<TicketStatus, "warning" | "success" | "default"> = { OPEN: "warning", ANSWERED: "success", CLOSED: "default" };

export function StatusChip({ status }: { status: TicketStatus }) {
  return <Chip size="small" color={STATUS_COLOR[status]} variant={status === "CLOSED" ? "outlined" : "filled"} label={TICKET_STATUS_LABELS[status]} />;
}

export interface ThreadMessage {
  id: string;
  from: "SELLER" | "STAFF";
  authorName: string | null;
  body: string;
  createdAt: string;
}

/**
 * The conversation of one request: the messages (plain text, line breaks kept: never HTML) and the reply box. The two sides share it; `viewer`
 * decides who is "you". Persistence and error text belong to the page that owns the data (`onSend` throws a Persian message to show).
 */
export default function TicketThread({ viewer, messages, onSend, disabledReason, actions }: {
  viewer: "SELLER" | "STAFF";
  messages: ThreadMessage[];
  onSend: (body: string) => Promise<void>;
  disabledReason?: string;
  actions?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSend(text);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ارسال ممکن نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2}>
      <Box component="ol" aria-label="پیام‌ها" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5 }}>
        {messages.map((m) => {
          const mine = m.from === viewer;
          const who = m.from === "STAFF" ? "پشتیبانی" : mine ? "شما" : (m.authorName ?? "فروشنده");
          return (
            <Box key={m.id} component="li" data-testid="ticket-message" data-from={m.from}>
              <Paper variant="outlined" sx={{ p: 1.5, maxWidth: 720, ml: mine ? "auto" : 0, mr: mine ? 0 : "auto", bgcolor: m.from === "STAFF" ? "action.hover" : "background.paper" }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 0.5, flexWrap: "wrap" }}>
                  <Typography component="span" variant="subtitle2" sx={{ fontWeight: 700 }}>{who}</Typography>
                  <Typography component="span" variant="caption" color="text.secondary">{date(m.createdAt)}</Typography>
                </Stack>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.body}</Typography>
              </Paper>
            </Box>
          );
        })}
      </Box>
      {disabledReason ? (
        <Alert severity="info">{disabledReason}</Alert>
      ) : (
        <Box component="form" onSubmit={submit} noValidate>
          {error && <Alert severity="error" role="alert" sx={{ mb: 1 }}>{error}</Alert>}
          <TextField label="پیام شما" value={text} onChange={(e) => setText(e.target.value)} multiline minRows={3} fullWidth slotProps={{ htmlInput: { maxLength: BODY_MAX } }} helperText={`${text.length.toLocaleString("fa-IR")} از ${BODY_MAX.toLocaleString("fa-IR")}`} />
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
            <Button type="submit" variant="contained" disabled={busy || text.trim().length === 0}>{busy ? "در حال ارسال…" : "ارسال پیام"}</Button>
            {actions}
          </Stack>
        </Box>
      )}
      {disabledReason && actions}
    </Stack>
  );
}
