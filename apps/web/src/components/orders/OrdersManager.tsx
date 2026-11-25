"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { ORDER_STATUSES, type OrderStatus } from "@store-builder/shared/modules/orders/orders";
import { listOrders, type OrderDto } from "@/client/api";
import { ORDER_STATUS_LABELS, STATUS_COLOR, date, failText, toman } from "./labels";

/** The store's orders, newest first, filtered by status, paged with "more" (phase 3.4). */
export default function OrdersManager({ storeId, customerId, initialStatus, initialReview }: { storeId: string; customerId?: string; initialStatus?: OrderStatus; initialReview?: "receipt" }) {
  // M2: ?review=receipt (from the overview) = card-to-card orders whose receipt waits for review; a status tab clears it.
  const [review, setReview] = useState<"receipt" | undefined>(initialReview);
  const [status, setStatus] = useState<OrderStatus | "ALL">(initialReview ? "AWAITING_PAYMENT" : (initialStatus ?? "ALL"));
  const [items, setItems] = useState<OrderDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useCallback((before?: string) => listOrders(storeId, { status: status === "ALL" ? undefined : status, customerId, review, before, limit: "30" }), [storeId, status, customerId, review]);

  // First page whenever the filter changes (state is set only when the answer arrives).
  useEffect(() => {
    let live = true;
    query()
      .then((page) => {
        if (!live) return;
        setItems(page.items);
        setNext(page.nextCursor);
        setError(null);
      })
      .catch((e) => live && setError(failText(e)));
    return () => {
      live = false;
    };
  }, [query]);

  async function more(before: string) {
    setBusy(true);
    try {
      const page = await query(before);
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNext(page.nextCursor);
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Tabs value={status} onChange={(_, v) => { setReview(undefined); setStatus(v); }} variant="scrollable" allowScrollButtonsMobile aria-label="وضعیت سفارش">
        <Tab value="ALL" label="همه" />
        {ORDER_STATUSES.map((s) => <Tab key={s} value={s} label={ORDER_STATUS_LABELS[s]} />)}
      </Tabs>
      {review === "receipt" && (
        <Alert severity="info">
          فقط سفارش‌های کارت‌به‌کارتی که رسیدشان منتظر بررسی شماست. <a href={`/dashboard/stores/${encodeURIComponent(storeId)}/orders`}>همهٔ سفارش‌ها</a>
        </Alert>
      )}
      {customerId && <Alert severity="info">فقط سفارش‌های یک مشتری نمایش داده می‌شود. <a href={`/dashboard/stores/${encodeURIComponent(storeId)}/orders`}>همهٔ سفارش‌ها</a></Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {items && items.length === 0 && <Typography color="text.secondary">{review === "receipt" ? "رسیدی منتظر بررسی نیست." : "سفارشی با این وضعیت نیست."}</Typography>}
      {items && items.length > 0 && (
        <TableContainer>
          <Table size="small" aria-label="سفارش‌ها">
            <TableHead>
              <TableRow>
                <TableCell>شماره</TableCell>
                <TableCell>تاریخ</TableCell>
                <TableCell>گیرنده</TableCell>
                <TableCell>مبلغ</TableCell>
                <TableCell>وضعیت</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((o) => (
                <TableRow key={o.id} hover>
                  <TableCell><a href={`/dashboard/stores/${encodeURIComponent(storeId)}/orders/${encodeURIComponent(o.id)}`}>#{o.number.toLocaleString("fa-IR")}</a></TableCell>
                  <TableCell>{date(o.createdAt)}</TableCell>
                  <TableCell>{o.address.recipientName}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{toman(o.total)}</TableCell>
                  <TableCell><Chip size="small" color={STATUS_COLOR[o.status]} label={ORDER_STATUS_LABELS[o.status]} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {next && <Box><Button variant="outlined" onClick={() => more(next)} disabled={busy}>سفارش‌های قدیمی‌تر</Button></Box>}
    </Box>
  );
}
