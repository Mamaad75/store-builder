"use client";

import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getAudit, type AuditEntry } from "@/client/api";
import { date, failText } from "@/components/orders/labels";
import { AUDIT_GROUPS, AUDIT_GROUP_LABELS, auditActionGroup, auditActionLabel, auditDetails, type AuditGroup } from "@store-builder/shared/modules/access/audit-labels";

const PAGE = 50;
const GROUP_COLOR: Record<AuditGroup, "default" | "primary" | "success" | "info" | "warning" | "secondary" | "error"> = {
  store: "primary",
  catalog: "success",
  orders: "info",
  pages: "secondary",
  team: "warning",
  payments: "info",
  security: "error",
};

/**
 * What happened in the store, newest first: who did what and when (owner and manager). Entries load 50 at a time; the group filter narrows
 * what is already loaded. Only a few short, safe details are shown next to an entry (see shared/modules/access/audit-labels.ts).
 */
export default function AuditLog({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [group, setGroup] = useState<AuditGroup | "all">("all");

  useEffect(() => {
    let live = true;
    getAudit(storeId)
      .then((r) => {
        if (!live) return;
        setRows(r);
        setMore(r.length === PAGE);
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof Error && e.name === "PermissionDeniedError") setDenied(true);
        else setError(failText(e));
      });
    return () => {
      live = false;
    };
  }, [storeId]);

  async function loadMore() {
    if (!rows?.length) return;
    setLoading(true);
    try {
      const next = await getAudit(storeId, rows[rows.length - 1]!.createdAt);
      const seen = new Set(rows.map((r) => r.id));
      setRows([...rows, ...next.filter((r) => !seen.has(r.id))]);
      setMore(next.length === PAGE);
    } catch (e) {
      setError(failText(e));
    } finally {
      setLoading(false);
    }
  }

  const shown = useMemo(() => (rows ?? []).filter((r) => group === "all" || auditActionGroup(r.action) === group), [rows, group]);
  if (denied) return <Alert severity="info">گزارش فعالیت‌ها فقط برای مالک و مدیر فروشگاه است.</Alert>;

  return (
    <Box sx={{ display: "grid", gap: 2.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 800 }}>گزارش فعالیت‌ها</Typography>
          <Typography color="text.secondary">چه کسی، چه کاری را و چه زمانی انجام داده است. این گزارش را نمی‌توان ویرایش یا حذف کرد.</Typography>
        </Box>
        <TextField select size="small" label="نوع فعالیت" value={group} onChange={(e) => setGroup(e.target.value as AuditGroup | "all")} sx={{ minWidth: 200 }}>
          <MenuItem value="all">همه</MenuItem>
          {AUDIT_GROUPS.map((g) => (
            <MenuItem key={g} value={g}>{AUDIT_GROUP_LABELS[g]}</MenuItem>
          ))}
        </TextField>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {!rows && !error && <Skeleton variant="rounded" height={160} role="status" aria-label="در حال بارگذاری گزارش" />}

      {rows && (
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
          {shown.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 3 }} data-testid="audit-empty">
              {rows.length === 0 ? "هنوز فعالیتی ثبت نشده است." : "در موارد بارگذاری‌شده فعالیتی از این نوع نیست."}
              {rows.length > 0 && more && " «بارگذاری موارد قدیمی‌تر» را بزنید."}
            </Typography>
          ) : (
            // Scrolls sideways on narrow screens: focusable and named so keyboard users can scroll it.
            <Box sx={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="فهرست فعالیت‌ها">
              <Table size="small" aria-label="فعالیت‌های فروشگاه" sx={{ "& th, & td": { px: { xs: 1, sm: 2 }, py: 1.25 } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>زمان</TableCell>
                    <TableCell>انجام‌دهنده</TableCell>
                    <TableCell>فعالیت</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shown.map((r) => {
                    const g = auditActionGroup(r.action);
                    const details = auditDetails(r.metadata);
                    return (
                      <TableRow key={r.id} data-testid="audit-row" data-action={r.action}>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{date(r.createdAt)}</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{r.actorUsername ? <span dir="ltr">@{r.actorUsername}</span> : "سیستم"}</TableCell>
                        <TableCell>
                          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                            {g && <Chip size="small" variant="outlined" color={GROUP_COLOR[g]} label={AUDIT_GROUP_LABELS[g]} />}
                            <span>{auditActionLabel(r.action)}</span>
                            {details.map((d, i) => (
                              <Typography key={i} component="span" variant="caption" color="text.secondary">{d}</Typography>
                            ))}
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>
      )}

      {more && (
        <Box>
          <Button variant="outlined" onClick={() => void loadMore()} disabled={loading}>بارگذاری موارد قدیمی‌تر</Button>
        </Box>
      )}
    </Box>
  );
}
