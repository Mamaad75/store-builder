"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { listAccounts, type PlatformAccount } from "@/client/platform-api";
import { TextLink } from "@/components/NextLinks";
import { date } from "@/components/orders/labels";

const PAGE = 50;

/** Every account, newest first, with a search by username or name. */
export default function AccountsList() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [rows, setRows] = useState<PlatformAccount[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => listAccounts({ q: applied }).then((r) => { setRows(r); setMore(r.length === PAGE); setError(null); }).catch(() => setError("بارگذاری ممکن نشد.")), [applied]);
  useEffect(() => {
    load();
  }, [load]);
  async function older() {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    try {
      const next = await listAccounts({ q: applied, before: last.createdAt });
      setRows([...(rows ?? []), ...next]);
      setMore(next.length === PAGE);
    } catch {
      setError("بارگذاری ممکن نشد.");
    }
  }
  function search(e: FormEvent) {
    e.preventDefault();
    setRows(null);
    setApplied(q.trim());
  }
  return (
    <Stack spacing={2}>
      <Box component="form" onSubmit={search} role="search" aria-label="جستجوی کاربران" sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <TextField size="small" label="نام کاربری یا نام" value={q} onChange={(e) => setQ(e.target.value)} sx={{ minWidth: 240 }} slotProps={{ htmlInput: { maxLength: 60 } }} />
        <Button type="submit" variant="outlined">جستجو</Button>
        {applied && <Button onClick={() => { setQ(""); setRows(null); setApplied(""); }}>پاک‌کردن جستجو</Button>}
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {!rows && !error && <Skeleton variant="rounded" height={72} />}
      {rows && rows.length === 0 && <Typography color="text.secondary">کاربری پیدا نشد.</Typography>}
      {rows && rows.length > 0 && (
        <Box component="ul" aria-label="کاربران" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
          {rows.map((a) => (
            <Paper key={a.id} component="li" variant="outlined" data-testid="account-row" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <Box sx={{ minWidth: 0 }}>
                <TextLink href={`/platform/users/${a.id}`} underline="hover" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}><bdi dir="ltr">{a.username}</bdi></TextLink>
                <Typography variant="body2" color="text.secondary">{a.name} · ثبت‌نام {date(a.createdAt)}</Typography>
              </Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                {a.isPlatformAdmin && <Chip size="small" color="warning" label="سوپرادمین" sx={{ bgcolor: "#7a2e00", color: "#fff" }} />}
                <Chip size="small" variant="outlined" label={`${a.stores.toLocaleString("fa-IR")} فروشگاه`} />
              </Stack>
            </Paper>
          ))}
        </Box>
      )}
      {more && <Box><Button variant="outlined" onClick={older}>نمایش قدیمی‌تر</Button></Box>}
    </Stack>
  );
}
