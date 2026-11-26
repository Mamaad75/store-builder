"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { closeTicket, getTicket, replyTicket, type TicketDetailDto } from "@/client/api";
import { TextLink } from "@/components/NextLinks";
import { failText } from "@/components/orders/labels";
import TicketThread, { StatusChip } from "./TicketThread";

/** One request of the merchant: its conversation, a reply box, and closing it. A reply to a closed request reopens it. */
export default function TicketView({ storeId, ticketId }: { storeId: string; ticketId: string }) {
  const [t, setT] = useState<TicketDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => getTicket(storeId, ticketId).then(setT).catch((e) => setError(e instanceof Error && e.name === "NotFoundError" ? "این درخواست پیدا نشد." : failText(e))), [storeId, ticketId]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!t) return <Skeleton variant="rounded" height={160} />;
  return (
    <Stack spacing={2}>
      <TextLink href={`/dashboard/stores/${storeId}/tickets`} underline="hover">→ همهٔ درخواست‌ها</TextLink>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{t.subject}</Typography>
        <StatusChip status={t.status} />
      </Stack>
      <TicketThread
        viewer="SELLER"
        messages={t.messages}
        onSend={async (body) => {
          try {
            await replyTicket(storeId, ticketId, body);
          } catch (e) {
            throw new Error(failText(e));
          }
          await load();
        }}
        actions={
          t.status !== "CLOSED" && (
            <Button variant="outlined" onClick={async () => { try { await closeTicket(storeId, ticketId); await load(); } catch (e) { setError(failText(e)); } }}>
              بستن درخواست
            </Button>
          )
        }
      />
      {t.status === "CLOSED" && <Box><Typography variant="caption" color="text.secondary">این درخواست بسته است؛ با ارسال پیام تازه دوباره باز می‌شود.</Typography></Box>}
    </Stack>
  );
}
