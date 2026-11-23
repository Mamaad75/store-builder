"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { formatIranMobile } from "@store-builder/shared/lib/phone";
import { customerStats, listCustomers, type CustomerRow, type CustomerStats } from "@/client/api";
import { failText, toman } from "./labels";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fa-IR", { dateStyle: "medium" }) : "—");

/**
 * The store's customers (phase 3.3b): everyone who signed in or ordered (guest orders are attached by phone), newest first, with their
 * order count, spending (not cancelled) and last order. "Verified" = the phone was proven by an SMS code.
 */
export default function CustomersManager({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [stats, setStats] = useState<Map<string, CustomerStats>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  async function load(before?: string) {
    try {
      const page = await listCustomers(storeId, before);
      setRows((prev) => (before && prev ? [...prev, ...page] : page));
      setMore(page.length === 50);
      if (page.length) {
        const s = await customerStats(storeId, page.map((c) => c.id));
        setStats((prev) => new Map([...prev, ...s.map((x) => [x.customerId, x] as const)]));
      }
    } catch (e) {
      setError(failText(e));
    }
  }

  useEffect(() => {
    let live = true;
    listCustomers(storeId)
      .then(async (page) => {
        if (!live) return;
        setRows(page);
        setMore(page.length === 50);
        if (page.length) {
          const s = await customerStats(storeId, page.map((c) => c.id));
          if (live) setStats(new Map(s.map((x) => [x.customerId, x] as const)));
        }
      })
      .catch((e) => live && setError(failText(e)));
    return () => {
      live = false;
    };
  }, [storeId]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!rows) return <Typography color="text.secondary">در حال بارگذاری…</Typography>;
  if (rows.length === 0) return <Typography color="text.secondary">هنوز مشتری‌ای ندارید. با اولین سفارش یا ثبت‌نام در فروشگاه، مشتری‌ها اینجا دیده می‌شوند.</Typography>;
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <TableContainer>
        <Table size="small" aria-label="مشتری‌ها">
          <TableHead>
            <TableRow>
              <TableCell>نام</TableCell>
              <TableCell>موبایل</TableCell>
              <TableCell>سفارش‌ها</TableCell>
              <TableCell>مجموع خرید</TableCell>
              <TableCell>آخرین سفارش</TableCell>
              <TableCell>عضویت</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((c) => {
              const st = stats.get(c.id);
              return (
                <TableRow key={c.id} hover>
                  <TableCell>{c.name ?? "—"}</TableCell>
                  <TableCell><span dir="ltr">{formatIranMobile(c.phone)}</span> {c.phoneVerifiedAt && <Chip size="small" color="success" variant="outlined" label="تأییدشده" />}</TableCell>
                  <TableCell>
                    {st?.orders ? <a href={`/dashboard/stores/${encodeURIComponent(storeId)}/orders?customer=${encodeURIComponent(c.id)}`}>{st.orders.toLocaleString("fa-IR")} سفارش</a> : "—"}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{st ? toman(st.spent) : "—"}</TableCell>
                  <TableCell>{day(st?.lastOrderAt ?? null)}</TableCell>
                  <TableCell>{day(c.createdAt)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {more && <Box><Button variant="outlined" onClick={() => load(rows[rows.length - 1]!.createdAt)}>مشتری‌های قدیمی‌تر</Button></Box>}
    </Box>
  );
}
