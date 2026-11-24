"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { SUSPENSION_REASONS, SUSPENSION_REASON_LABELS, type SuspensionReason } from "@store-builder/shared/modules/platform/suspension";
import { StoreSuspensionConflictError } from "@store-builder/shared/modules/platform/errors";
import { DraftBusyError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { getSuspensions, restoreStore, suspendStore, type SuspensionRow } from "@/client/platform-api";
import { transportState } from "@/client/guard";

const errorText = (e: unknown): { error: string; fields?: Record<string, string[]> } => {
  const t = transportState(e);
  if (t?.error) return { error: t.error };
  if (e instanceof ValidationError) return { error: "مقدارها را بررسی کنید.", fields: e.fieldErrors };
  if (e instanceof StoreSuspensionConflictError) return { error: e.message + " صفحه را تازه کنید." };
  // Review G2: the store row is held by a merchant change or a publish right now; nothing was changed.
  if (e instanceof DraftBusyError) return { error: "فروشگاه همین حالا در حال ذخیره یا انتشار است؛ چند ثانیه بعد دوباره امتحان کنید." };
  return { error: "انجام نشد. دوباره امتحان کنید." };
};
const date = (iso: string) => new Date(iso).toLocaleString("fa-IR");

/**
 * ADR 0003 (G2): suspend / restore one store from the platform's store list, and its suspension history. Suspension is independent of the
 * merchant's publishing status: restoring never publishes the store. The internal note is visible here only.
 */
export default function StoreSuspension({ storeId, storeName, suspended }: { storeId: string; storeName: string; suspended: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<null | "suspend" | "restore" | "history">(null);
  const [reason, setReason] = useState<SuspensionReason>("FRAUD");
  const [publicMessage, setPublicMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [note, setNote] = useState("");
  const [fb, setFb] = useState<{ error?: string; fields?: Record<string, string[]> }>({});
  const [history, setHistory] = useState<SuspensionRow[] | null>(null);

  const close = () => {
    setOpen(null);
    setFb({});
  };
  const run = (work: () => Promise<unknown>) =>
    start(async () => {
      try {
        await work();
        close();
        router.refresh();
      } catch (e) {
        setFb(errorText(e));
      }
    });
  const showHistory = () => {
    setOpen("history");
    setHistory(null);
    start(async () => {
      try {
        setHistory(await getSuspensions(storeId));
      } catch (e) {
        setFb(errorText(e));
      }
    });
  };

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
      {suspended ? <Chip size="small" color="error" label="معلق" /> : null}
      {suspended ? (
        <Button size="small" onClick={() => setOpen("restore")}>رفع تعلیق</Button>
      ) : (
        <Button size="small" color="error" onClick={() => setOpen("suspend")}>تعلیق</Button>
      )}
      <Button size="small" onClick={showHistory}>سابقه</Button>

      <Dialog open={open === "suspend"} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>تعلیق «{storeName}»</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="warning">ویترین برای خریداران بسته می‌شود و فروشنده جز مدیریت سفارش‌های موجود کاری نمی‌تواند بکند. تصاویر عمومی حذف نمی‌شوند.</Alert>
            <TextField select label="دلیل" value={reason} onChange={(e) => setReason(e.target.value as SuspensionReason)}>
              {SUSPENSION_REASONS.map((r) => <MenuItem key={r} value={r}>{SUSPENSION_REASON_LABELS[r]}</MenuItem>)}
            </TextField>
            <TextField label="پیام برای فروشنده (به خریداران نشان داده نمی‌شود)" value={publicMessage} onChange={(e) => setPublicMessage(e.target.value)} multiline minRows={2} required error={!!fb.fields?.publicMessage} helperText={fb.fields?.publicMessage?.[0]} />
            <TextField label="یادداشت داخلی (فقط مدیران پلتفرم)" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} multiline minRows={2} error={!!fb.fields?.internalNote} helperText={fb.fields?.internalNote?.[0]} />
            {fb.error && <Alert severity="error" role="alert">{fb.error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>انصراف</Button>
          <Button color="error" variant="contained" disabled={pending || publicMessage.trim() === ""} onClick={() => run(() => suspendStore(storeId, { reason, publicMessage, internalNote }))}>تعلیق</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={open === "restore"} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>رفع تعلیق «{storeName}»</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography>رفع تعلیق فقط همین محدودیت را برمی‌دارد: اگر فروشنده فروشگاه را از انتشار خارج کرده باشد، منتشر نمی‌شود.</Typography>
            <TextField label="یادداشت رفع تعلیق" value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} required error={!!fb.fields?.note} helperText={fb.fields?.note?.[0]} />
            {fb.error && <Alert severity="error" role="alert">{fb.error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>انصراف</Button>
          <Button variant="contained" disabled={pending || note.trim() === ""} onClick={() => run(() => restoreStore(storeId, note))}>رفع تعلیق</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={open === "history"} onClose={close} fullWidth maxWidth="md">
        <DialogTitle>سابقه‌ی تعلیق «{storeName}»</DialogTitle>
        <DialogContent>
          {fb.error && <Alert severity="error" role="alert">{fb.error}</Alert>}
          {history === null && !fb.error && <Typography role="status">در حال بارگذاری…</Typography>}
          {history?.length === 0 && <Typography role="status">این فروشگاه هیچ‌وقت معلق نشده است.</Typography>}
          <Stack spacing={2}>
            {history?.map((h) => (
              <Alert key={h.id} severity={h.liftedAt ? "info" : "error"} icon={false}>
                <Typography sx={{ fontWeight: 700 }}>{SUSPENSION_REASON_LABELS[h.reason as SuspensionReason] ?? h.reason} — از {date(h.suspendedAt)}{h.liftedAt ? ` تا ${date(h.liftedAt)}` : " (باز)"}</Typography>
                <Typography>پیام به فروشنده: {h.publicMessage}</Typography>
                {h.internalNote && <Typography>یادداشت داخلی: {h.internalNote}</Typography>}
                {h.liftNote && <Typography>یادداشت رفع تعلیق: {h.liftNote}</Typography>}
              </Alert>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>بستن</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
