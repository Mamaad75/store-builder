"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getAccount, type PlatformAccountDetail } from "@/client/platform-api";
import { TextLink } from "@/components/NextLinks";
import { date } from "@/components/orders/labels";

const STATUS: Record<string, string> = { DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده" };

/** One account: who it is and the stores it owns. Never a password hash or anything secret (the API does not send it). Recovery stays under "دسترسی و بازیابی". */
export default function AccountView({ userId }: { userId: string }) {
  const [a, setA] = useState<PlatformAccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getAccount(userId).then((r) => live && setA(r)).catch((e) => live && setError(e instanceof Error && e.name === "NotFoundError" ? "این کاربر پیدا نشد." : "بارگذاری ممکن نشد."));
    return () => {
      live = false;
    };
  }, [userId]);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!a) return <Skeleton variant="rounded" height={160} />;
  return (
    <Stack spacing={2.5}>
      <TextLink href="/platform/users" underline="hover">→ کاربران</TextLink>
      <Box>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography component="h1" variant="h5" sx={{ fontWeight: 800 }}><bdi dir="ltr">{a.username}</bdi></Typography>
          {a.isPlatformAdmin && <Chip size="small" label="سوپرادمین" sx={{ bgcolor: "#7a2e00", color: "#fff" }} />}
        </Stack>
        <Typography color="text.secondary" data-testid="account-summary">
          {a.name} · ثبت‌نام {date(a.createdAt)}{a.recoveredAt ? ` · آخرین بازیابی حساب ${date(a.recoveredAt)}` : ""}{a.memberships ? ` · عضو تیم ${a.memberships.toLocaleString("fa-IR")} فروشگاه` : ""}
        </Typography>
      </Box>
      <Box component="section" aria-labelledby="owned-h">
        <Typography id="owned-h" variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1 }}>فروشگاه‌های این کاربر</Typography>
        {a.ownedStores.length === 0 ? <Typography color="text.secondary">فروشگاهی ندارد.</Typography> : (
          <Box component="ul" aria-label="فروشگاه‌ها" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
            {a.ownedStores.map((s) => (
              <Paper key={s.id} component="li" variant="outlined" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <TextLink href={`/platform/stores/${s.id}`} underline="hover" sx={{ fontWeight: 700 }}>{s.name}</TextLink>
                <Stack direction="row" spacing={1}>
                  <Chip size="small" variant="outlined" label={STATUS[s.status] ?? s.status} />
                  {s.suspended && <Chip size="small" color="error" label="معلق" />}
                </Stack>
              </Paper>
            ))}
          </Box>
        )}
      </Box>
    </Stack>
  );
}
