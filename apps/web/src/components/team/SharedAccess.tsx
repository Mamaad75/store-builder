"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { LinkButton } from "@/components/NextLinks";
import { acceptInvitation, declineInvitation, leaveStore } from "@/client/api";
import { go, refresh } from "@/client/nav";
import { failText } from "@/components/orders/labels";
import { ROLE_LABELS, type StaffRole } from "@store-builder/shared/modules/access/permissions";

export interface PendingInvitation {
  id: string;
  storeId: string;
  storeName: string;
  role: StaffRole;
  invitedBy: string;
  expiresAt: string;
}
export interface SharedStoreItem {
  storeId: string;
  name: string;
  role: StaffRole;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("fa-IR", { dateStyle: "medium" });
/** Where a staff member lands: a manager on the dashboard, an operator (no orders or settings) on the products. */
const landing = (storeId: string, role: StaffRole) => `/dashboard/stores/${encodeURIComponent(storeId)}/${role === "OPERATOR" ? "products" : "dashboard"}`;

/**
 * For someone who works on other people's stores: the invitations waiting for an answer, and the stores they already work on. Both come
 * from the API bound to the signed-in account; nothing here can reach a store the person was not invited to.
 */
export default function SharedAccess({ invitations, shared }: { invitations: PendingInvitation[]; shared: SharedStoreItem[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<SharedStoreItem | null>(null);
  if (invitations.length === 0 && shared.length === 0) return null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ display: "grid", gap: 2.5 }} data-testid="shared-access">
      {error && <Alert severity="error">{error}</Alert>}

      {invitations.length > 0 && (
        <Paper variant="outlined" component="section" aria-labelledby="inv-h" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3, borderColor: "warning.light", bgcolor: "#fffbeb" }}>
          <Typography id="inv-h" component="h2" variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>دعوت‌های همکاری</Typography>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5 }}>
            {invitations.map((i) => (
              <Box key={i.id} component="li" data-testid={`my-invitation-${i.storeName}`} sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                <Typography sx={{ flex: "1 1 240px" }}>
                  <strong>{i.invitedBy}</strong> شما را به فروشگاه «{i.storeName}» با نقش <strong>{ROLE_LABELS[i.role]}</strong> دعوت کرده است.
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>معتبر تا {day(i.expiresAt)}</Typography>
                </Typography>
                <Button variant="contained" size="small" disabled={busy} onClick={() => void run(async () => go(landing((await acceptInvitation(i.id)).storeId, i.role)))} aria-label={`پذیرش دعوت فروشگاه ${i.storeName}`}>
                  پذیرش
                </Button>
                <Button size="small" color="inherit" disabled={busy} onClick={() => void run(async () => { await declineInvitation(i.id); refresh(); })} aria-label={`رد دعوت فروشگاه ${i.storeName}`}>
                  رد
                </Button>
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {shared.length > 0 && (
        <Paper variant="outlined" component="section" aria-labelledby="shared-h" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3 }}>
          <Typography id="shared-h" component="h2" variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>فروشگاه‌هایی که در آن‌ها همکارم</Typography>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5 }}>
            {shared.map((s) => (
              <Box key={s.storeId} component="li" data-testid={`shared-store-${s.name}`} sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                <Typography sx={{ flex: "1 1 200px", fontWeight: 700 }}>{s.name}</Typography>
                <Chip size="small" label={ROLE_LABELS[s.role]} />
                <LinkButton href={landing(s.storeId, s.role)} size="small" variant="outlined" aria-label={`ورود به فروشگاه ${s.name}`}>ورود</LinkButton>
                <Button size="small" color="error" disabled={busy} onClick={() => setLeaving(s)} aria-label={`ترک همکاری در ${s.name}`}>ترک همکاری</Button>
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      <Dialog open={!!leaving} onClose={() => setLeaving(null)} aria-labelledby="leave-title" aria-describedby="leave-desc">
        <DialogTitle id="leave-title">ترک همکاری در «{leaving?.name}»؟</DialogTitle>
        <DialogContent>
          <DialogContentText id="leave-desc">دسترسی شما به این فروشگاه قطع می‌شود. برای بازگشت باید مالک دوباره دعوتتان کند.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLeaving(null)}>انصراف</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={() => {
              const s = leaving!;
              setLeaving(null);
              void run(async () => {
                await leaveStore(s.storeId);
                refresh();
              });
            }}
          >
            ترک همکاری
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
