"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { PLATFORM_AUDIT_GROUPS, PLATFORM_AUDIT_GROUP_LABELS, platformAuditDetails, platformAuditLabel, type PlatformAuditGroup } from "@store-builder/shared/modules/platform/insights";
import { listActivity, type PlatformActivity } from "@/client/platform-api";
import { date } from "@/components/orders/labels";

const PAGE = 50;

/** What the platform's super admins did, newest first: who, what, when. Only a few safe facts are shown beside an entry; free text and notes never. */
export default function ActivityLog() {
  const [group, setGroup] = useState<PlatformAuditGroup | "all">("all");
  const [rows, setRows] = useState<PlatformActivity[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => listActivity({ group: group === "all" ? undefined : group }).then((r) => { setRows(r); setMore(r.length === PAGE); setError(null); }).catch(() => setError("بارگذاری ممکن نشد.")), [group]);
  useEffect(() => {
    load();
  }, [load]);
  async function older() {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    try {
      const next = await listActivity({ group: group === "all" ? undefined : group, before: last.createdAt });
      setRows([...(rows ?? []), ...next]);
      setMore(next.length === PAGE);
    } catch {
      setError("بارگذاری ممکن نشد.");
    }
  }
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <TextField select size="small" label="گروه" value={group} onChange={(e) => { setRows(null); setGroup(e.target.value as PlatformAuditGroup | "all"); }} sx={{ maxWidth: 260 }}>
        <MenuItem value="all">همه</MenuItem>
        {PLATFORM_AUDIT_GROUPS.map((g) => <MenuItem key={g} value={g}>{PLATFORM_AUDIT_GROUP_LABELS[g]}</MenuItem>)}
      </TextField>
      {error && <Alert severity="error">{error}</Alert>}
      {!rows && !error && <Skeleton variant="rounded" height={72} />}
      {rows && rows.length === 0 && <Typography color="text.secondary">موردی ثبت نشده است.</Typography>}
      {rows && rows.length > 0 && (
        <Box component="ul" aria-label="فعالیت‌ها" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
          {rows.map((r) => {
            const details = platformAuditDetails(r.metadata);
            return (
              <Paper key={r.id} component="li" variant="outlined" data-testid="activity-row" sx={{ p: 1.5 }}>
                <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                  <Typography sx={{ fontWeight: 700 }}>{platformAuditLabel(r.action)}</Typography>
                  {r.group && <Chip size="small" variant="outlined" label={PLATFORM_AUDIT_GROUP_LABELS[r.group as PlatformAuditGroup]} />}
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {r.actor ? <bdi dir="ltr">{r.actor}</bdi> : "سامانه"} · {date(r.createdAt)}{details.length ? ` · ${details.join(" · ")}` : ""}
                </Typography>
              </Paper>
            );
          })}
        </Box>
      )}
      {more && <Box><Button variant="outlined" onClick={older}>نمایش قدیمی‌تر</Button></Box>}
    </Box>
  );
}
