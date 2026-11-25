"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { domainErrorMessage } from "@store-builder/shared/errors/registry";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { createInvite, findPlatformUser, listInvites, recoverUser, revokeInvite, updatePlatformSettings, type InviteRow, type PlatformUser } from "@/client/platform-api";
import { transportState } from "@/client/guard";

const ltr = { htmlInput: { dir: "ltr" as const } };
const STATUS: Record<InviteRow["status"], { label: string; color: "success" | "default" | "warning" | "error" }> = {
  active: { label: "فعال", color: "success" },
  used: { label: "استفاده‌شده", color: "default" },
  expired: { label: "منقضی", color: "warning" },
  revoked: { label: "باطل‌شده", color: "error" },
};
const date = (iso: string) => new Date(iso).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });

function messageOf(e: unknown): { error: string; fieldErrors?: Record<string, string[]> } {
  const t = transportState(e);
  if (t?.error) return { error: t.error };
  if (e instanceof ValidationError) return { error: "مقدارها را بررسی کنید.", fieldErrors: e.fieldErrors };
  if (e instanceof Error) return { error: domainErrorMessage(e.name) ?? "انجام نشد؛ دوباره تلاش کنید." };
  return { error: "انجام نشد؛ دوباره تلاش کنید." };
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card variant="outlined" component="section" aria-label={title}>
      <CardContent>
        <Typography component="h2" variant="h6" sx={{ fontWeight: 800, mb: 1 }}>{title}</Typography>
        <Typography sx={{ color: "text.secondary", mb: 2 }}>{description}</Typography>
        {children}
      </CardContent>
    </Card>
  );
}

/** MVP item 2 (pilot): who may sign up, single-use invitations, and account recovery after an out-of-band identity check. */
export default function AccessManager({ initialMode }: { initialMode: "invite" | "open" }) {
  return (
    <Stack spacing={3}>
      <RegistrationMode initialMode={initialMode} />
      <Invites />
      <Recovery />
    </Stack>
  );
}

function RegistrationMode({ initialMode }: { initialMode: "invite" | "open" }) {
  const [open, setOpen] = useState(initialMode === "open");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  async function save(next: boolean) {
    setBusy(true);
    try {
      await updatePlatformSettings("registration", { mode: next ? "open" : "invite" });
      setOpen(next);
      setMsg({ ok: next ? "ثبت‌نام برای همه باز شد." : "ثبت‌نام فقط با کد دعوت ممکن است." });
    } catch (e) {
      setMsg(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="ثبت‌نام فروشنده" description="در دوره‌ی آزمایشی ثبت‌نام فقط با کد دعوت است. با باز کردن آن، هر کسی می‌تواند حساب بسازد.">
      <FormControlLabel control={<Switch checked={open} disabled={busy} onChange={(e) => void save(e.target.checked)} />} label={open ? "ثبت‌نام آزاد است" : "فقط با کد دعوت"} />
      {msg.error && <Alert severity="error" role="alert">{msg.error}</Alert>}
      {msg.ok && <Alert severity="success" role="status">{msg.ok}</Alert>}
    </Section>
  );
}

function Invites() {
  const [rows, setRows] = useState<InviteRow[] | null>(null);
  const [note, setNote] = useState("");
  const [days, setDays] = useState("7");
  const [issued, setIssued] = useState<{ code: string; url: string; expiresAt: string } | null>(null);
  const [msg, setMsg] = useState<{ error?: string; fieldErrors?: Record<string, string[]> }>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => listInvites().then(setRows).catch((e) => setMsg(messageOf(e))), []);
  useEffect(() => void load(), [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg({});
    try {
      setIssued(await createInvite(note.trim(), Number(days)));
      setNote("");
      await load();
    } catch (err) {
      setMsg(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (!window.confirm("این کد دعوت باطل شود؟")) return;
    try {
      await revokeInvite(id);
      await load();
    } catch (err) {
      setMsg(messageOf(err));
    }
  }

  return (
    <Section title="کدهای دعوت" description="هر کد فقط یک بار و تا تاریخ انقضا کار می‌کند. کد فقط همین یک بار نمایش داده می‌شود؛ آن را مستقیم برای فروشنده بفرستید.">
      <Box component="form" noValidate onSubmit={create}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-start" } }}>
          <TextField label="یادداشت (برای چه کسی)" value={note} onChange={(e) => setNote(e.target.value)} error={!!msg.fieldErrors?.note} helperText={msg.fieldErrors?.note?.[0] ?? " "} slotProps={{ htmlInput: { maxLength: 100 } }} />
          <TextField label="اعتبار (روز، ۱ تا ۳۰)" value={days} onChange={(e) => setDays(e.target.value)} error={!!msg.fieldErrors?.days} helperText={msg.fieldErrors?.days?.[0] ?? " "} slotProps={{ htmlInput: { dir: "ltr", inputMode: "numeric" } }} sx={{ maxWidth: 180 }} />
          <Button type="submit" variant="contained" disabled={busy} sx={{ minHeight: 56 }}>ساخت کد دعوت</Button>
        </Stack>
      </Box>
      {issued && (
        <Alert severity="success" sx={{ mt: 1 }} data-testid="invite-issued">
          کد دعوت (فقط همین یک بار نمایش داده می‌شود): <Box component="code" dir="ltr">{issued.code}</Box>
          <br />
          پیوند ثبت‌نام: <Box component="span" dir="ltr" sx={{ wordBreak: "break-all" }}>{issued.url}</Box>
          <br />
          اعتبار تا {date(issued.expiresAt)}
        </Alert>
      )}
      {msg.error && <Alert severity="error" role="alert" sx={{ mt: 1 }}>{msg.error}</Alert>}
      {rows && rows.length > 0 && (
        <Box sx={{ overflowX: "auto", mt: 2 }} tabIndex={0} role="region" aria-label="فهرست کدهای دعوت">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>یادداشت</TableCell>
                <TableCell>ساخته‌شده</TableCell>
                <TableCell>انقضا</TableCell>
                <TableCell>وضعیت</TableCell>
                <TableCell>استفاده‌کننده</TableCell>
                <TableCell><Box component="span" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>کارها</Box></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.note || "—"}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{date(r.createdAt)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{date(r.expiresAt)}</TableCell>
                  <TableCell><Chip size="small" color={STATUS[r.status].color} label={STATUS[r.status].label} /></TableCell>
                  <TableCell dir="ltr">{r.usedBy ?? "—"}</TableCell>
                  <TableCell>{r.status === "active" && <Button size="small" color="error" onClick={() => void revoke(r.id)}>باطل کردن</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {rows && rows.length === 0 && <Typography color="text.secondary" sx={{ mt: 2 }}>هنوز کد دعوتی ساخته نشده است.</Typography>}
    </Section>
  );
}

function Recovery() {
  const [username, setUsername] = useState("");
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [reason, setReason] = useState("");
  const [verified, setVerified] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [msg, setMsg] = useState<{ error?: string; fieldErrors?: Record<string, string[]> }>({});
  const [busy, setBusy] = useState(false);

  async function find(e: FormEvent) {
    e.preventDefault();
    setMsg({});
    setLink(null);
    setUser(null);
    try {
      setUser(await findPlatformUser(username.trim()));
    } catch (err) {
      const m = messageOf(err);
      setMsg(m.error === "پیدا نشد." || (err instanceof Error && err.name === "NotFoundError") ? { error: "کاربری با این نام کاربری پیدا نشد." } : m);
    }
  }
  async function recover(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setMsg({});
    try {
      setLink(await recoverUser(user.id, { adminPassword, reason: reason.trim(), identityVerified: verified }));
      setAdminPassword("");
      setReason("");
      setVerified(false);
    } catch (err) {
      setMsg(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="بازیابی حساب فروشنده"
      description="فقط پس از اینکه هویت صاحب حساب را بیرون از سامانه (تماس تلفنی یا حضوری) بررسی کردید. رمز فعلی بلافاصله از کار می‌افتد، همه‌ی ورودها بسته می‌شوند و یک پیوند یک‌بارمصرف ۲۴ ساعته ساخته می‌شود. همه‌چیز با دلیل در گزارش فعالیت ثبت می‌شود."
    >
      <Box component="form" noValidate onSubmit={find}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-start" } }}>
          <TextField label="نام کاربری فروشنده" value={username} onChange={(e) => setUsername(e.target.value)} slotProps={ltr} />
          <Button type="submit" variant="outlined" disabled={username.trim() === ""} sx={{ minHeight: 56 }}>جستجو</Button>
        </Stack>
      </Box>
      {user && (
        <Box sx={{ mt: 2 }}>
          <Typography sx={{ fontWeight: 700 }}>
            {user.name} (<Box component="span" dir="ltr">{user.username}</Box>) — {user.stores.toLocaleString("fa-IR")} فروشگاه، عضو از {date(user.createdAt)}
          </Typography>
          {user.recoveredAt && <Typography color="text.secondary">آخرین بازیابی: {date(user.recoveredAt)}</Typography>}
          {user.isPlatformAdmin ? (
            <Alert severity="warning" sx={{ mt: 1 }}>حساب مدیر پلتفرم از این راه بازیابی نمی‌شود؛ از فرمان سرور استفاده کنید.</Alert>
          ) : (
            <Box component="form" noValidate onSubmit={recover} sx={{ mt: 1 }}>
              <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
                <TextField label="دلیل (چه کسی، چگونه بررسی شد)" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} error={!!msg.fieldErrors?.reason} helperText={msg.fieldErrors?.reason?.[0] ?? "دست‌کم ۱۰ نویسه؛ در گزارش فعالیت ثبت می‌شود."} slotProps={{ htmlInput: { maxLength: 500 } }} />
                <FormControlLabel
                  control={<Checkbox checked={verified} onChange={(e) => setVerified(e.target.checked)} />}
                  label="تأیید می‌کنم که هویت صاحب این حساب را بیرون از سامانه بررسی کرده‌ام."
                />
                {msg.fieldErrors?.identityVerified && <Typography color="error" variant="body2">{msg.fieldErrors.identityVerified[0]}</Typography>}
                <TextField type="password" label="رمز عبور خودتان (برای تأیید)" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} autoComplete="current-password" error={!!msg.fieldErrors?.adminPassword} helperText={msg.fieldErrors?.adminPassword?.[0] ?? " "} slotProps={ltr} />
                <Box><Button type="submit" variant="contained" color="warning" disabled={busy}>ساخت پیوند بازیابی</Button></Box>
              </Stack>
            </Box>
          )}
        </Box>
      )}
      {link && (
        <Alert severity="success" sx={{ mt: 2 }} data-testid="recovery-issued">
          پیوند بازیابی (فقط همین یک بار نمایش داده می‌شود؛ آن را فقط به صاحب حساب بدهید):
          <br />
          <Box component="span" dir="ltr" sx={{ wordBreak: "break-all" }}>{link.url}</Box>
          <br />
          اعتبار تا {date(link.expiresAt)}
        </Alert>
      )}
      {msg.error && <Alert severity="error" role="alert" sx={{ mt: 1 }}>{msg.error}</Alert>}
    </Section>
  );
}
