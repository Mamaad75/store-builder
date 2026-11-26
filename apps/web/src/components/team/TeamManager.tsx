"use client";

import { useCallback, useEffect, useState } from "react";
import PersonAddAlt1Outlined from "@mui/icons-material/PersonAddAlt1Outlined";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { cancelInvitation, changeMemberRole, getTeam, inviteStaff, removeMember, type TeamView } from "@/client/api";
import { failText } from "@/components/orders/labels";
import { MAX_STAFF_PER_STORE, ROLE_LABELS, type StaffRole } from "@store-builder/shared/modules/access/permissions";

const fa = (n: number) => n.toLocaleString("fa-IR");
const day = (iso: string) => new Date(iso).toLocaleDateString("fa-IR", { dateStyle: "medium" });
const ROLE_CHIP = { OWNER: "primary", MANAGER: "info", OPERATOR: "default" } as const;

/** What each role can do, in plain words (the API enforces the real table in shared/modules/access/permissions.ts). */
const ROLE_HELP: { role: "OWNER" | StaffRole; text: string }[] = [
  { role: "OWNER", text: "همهٔ کارها، از جمله حذف فروشگاه، مدیریت تیم، کلید درگاه پرداخت و کارت‌های بانکی." },
  { role: "MANAGER", text: "سفارش‌ها، مشتری‌ها، محصولات، تنظیمات، انتشار و تخفیف‌ها. بدون حذف فروشگاه، مدیریت تیم، کلید درگاه و کارت بانکی (شمارهٔ کارت‌ها را فقط ناقص می‌بیند)." },
  { role: "OPERATOR", text: "فقط محصولات، دسته‌بندی‌ها، صفحه‌ها و تصاویر. سفارش‌ها، مشتری‌ها، تنظیمات و انتشار را نمی‌بیند." },
];

function inviteError(e: unknown): string {
  const n = e instanceof Error ? e.name : "";
  if (n === "InvitationTargetError") {
    const reason = (e as Error & { reason?: string }).reason;
    return (
      {
        unknown_user: "کاربری با این نام کاربری پیدا نشد. همکار باید ابتدا در سامانه ثبت‌نام کرده باشد.",
        owner: "مالک فروشگاه را نمی‌توان به تیم دعوت کرد.",
        already_member: "این کاربر همین حالا عضو تیم است.",
        already_invited: "برای این کاربر قبلاً دعوت فرستاده‌اید و هنوز پاسخ نداده است.",
        self: "نمی‌توانید خودتان را دعوت کنید.",
      } as Record<string, string>
    )[reason ?? ""] ?? "این کاربر را نمی‌توان دعوت کرد.";
  }
  if (n === "StaffLimitError") return `تعداد همکاران و دعوت‌های در انتظار به سقف ${fa(MAX_STAFF_PER_STORE)} رسیده است.`;
  if (n === "PermissionDeniedError") return "مدیریت تیم فقط برای مالک فروشگاه است.";
  return failText(e);
}

/**
 * The store's team (owner only): invite an existing account as manager or operator, change a role, remove a member, cancel an invitation.
 * Everything is checked again by the API; a role without access gets a plain message instead of the page.
 */
export default function TeamManager({ storeId }: { storeId: string }) {
  const [team, setTeam] = useState<TeamView | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<StaffRole>("OPERATOR");
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);

  const show = useCallback((e: unknown) => {
    if (e instanceof Error && e.name === "PermissionDeniedError") setDenied(true);
    else setError(failText(e));
  }, []);
  /** After a change: read the team again. */
  const reload = useCallback(() => getTeam(storeId).then((t) => (setTeam(t), setError(null))).catch(show), [storeId, show]);
  useEffect(() => {
    let live = true;
    getTeam(storeId)
      .then((t) => live && setTeam(t))
      .catch((e) => live && show(e));
    return () => {
      live = false;
    };
  }, [storeId, show]);

  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await run();
      setNotice(done);
      await reload();
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    const name = username.trim();
    if (!name) {
      setFormError("نام کاربری همکار را وارد کنید.");
      return;
    }
    setBusy(true);
    try {
      await inviteStaff(storeId, { username: name, role });
      setUsername("");
      setNotice(`دعوت برای «${name}» فرستاده شد. همکار باید آن را در صفحهٔ «فروشگاه‌های من» بپذیرد.`);
      await reload();
    } catch (err) {
      setFormError(inviteError(err));
    } finally {
      setBusy(false);
    }
  }

  if (denied) return <Alert severity="info">مدیریت تیم فقط برای مالک فروشگاه است.</Alert>;
  const used = team ? team.members.length - 1 + team.invitations.length : 0; // the owner is not staff

  return (
    <Box sx={{ display: "grid", gap: 3 }}>
      <Box>
        <Typography variant="h5" component="h2" sx={{ fontWeight: 800 }}>تیم فروشگاه</Typography>
        <Typography color="text.secondary">همکارانتان را با نقش مشخص به فروشگاه اضافه کنید. هر کار همکار در «گزارش فعالیت‌ها» ثبت می‌شود.</Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success" role="status">{notice}</Alert>}

      <Paper variant="outlined" component="section" aria-labelledby="invite-h" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
        <Typography id="invite-h" component="h3" sx={{ fontWeight: 700, mb: 0.5 }}>دعوت همکار</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          همکار باید قبلاً در سامانه ثبت‌نام کرده باشد؛ نام کاربری او را وارد کنید. دعوت تا ۱۴ روز معتبر است. {team && `ظرفیت: ${fa(used)} از ${fa(MAX_STAFF_PER_STORE)}`}
        </Typography>
        <Box component="form" onSubmit={invite} noValidate sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "2fr 1fr auto" }, alignItems: "start" }}>
          <TextField
            label="نام کاربری همکار"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            size="small"
            fullWidth
            error={!!formError}
            helperText={formError ?? " "}
            slotProps={{ htmlInput: { maxLength: 64, dir: "ltr", autoCapitalize: "none", autoComplete: "off" } }}
          />
          <TextField select label="نقش" value={role} onChange={(e) => setRole(e.target.value as StaffRole)} size="small" fullWidth>
            <MenuItem value="MANAGER">{ROLE_LABELS.MANAGER}</MenuItem>
            <MenuItem value="OPERATOR">{ROLE_LABELS.OPERATOR}</MenuItem>
          </TextField>
          <Button type="submit" variant="contained" startIcon={<PersonAddAlt1Outlined />} disabled={busy} sx={{ height: 40 }}>
            ارسال دعوت
          </Button>
        </Box>
      </Paper>

      <Paper variant="outlined" component="section" aria-labelledby="members-h" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
        <Typography id="members-h" component="h3" sx={{ fontWeight: 700, mb: 2 }}>اعضای تیم</Typography>
        {!team && !error && <Skeleton variant="rounded" height={64} />}
        {team && (
          <Box component="ul" aria-label="اعضای تیم" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5 }}>
            {team.members.map((m) => (
              <Box key={m.userId} component="li" data-testid={`member-${m.username}`} sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", p: 1.5, borderRadius: 2.5, bgcolor: "#f8f9ff" }}>
                <Avatar aria-hidden sx={{ bgcolor: "#4f46e5", width: 40, height: 40 }}>{(m.name || m.username).slice(0, 1)}</Avatar>
                <Box sx={{ flex: "1 1 160px", minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }} noWrap>{m.name}</Typography>
                  <Typography variant="body2" color="text.secondary" dir="ltr" sx={{ textAlign: "start" }}>@{m.username}</Typography>
                </Box>
                {m.role === "OWNER" ? (
                  <Chip label={ROLE_LABELS.OWNER} color={ROLE_CHIP.OWNER} size="small" />
                ) : (
                  <>
                    <TextField
                      select
                      size="small"
                      label="نقش"
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => void act(() => changeMemberRole(storeId, m.userId, e.target.value as StaffRole), `نقش «${m.name}» تغییر کرد.`)}
                      sx={{ minWidth: 130 }}
                      slotProps={{ htmlInput: { "aria-label": `نقش ${m.name}` } }}
                    >
                      <MenuItem value="MANAGER">{ROLE_LABELS.MANAGER}</MenuItem>
                      <MenuItem value="OPERATOR">{ROLE_LABELS.OPERATOR}</MenuItem>
                    </TextField>
                    <Button color="error" size="small" disabled={busy} onClick={() => setRemoving({ userId: m.userId, name: m.name })} aria-label={`حذف ${m.name} از تیم`}>
                      حذف از تیم
                    </Button>
                  </>
                )}
                {m.since && <Typography variant="caption" color="text.secondary" sx={{ flexBasis: "100%" }}>عضو از {day(m.since)}</Typography>}
              </Box>
            ))}
          </Box>
        )}
      </Paper>

      {team && team.invitations.length > 0 && (
        <Paper variant="outlined" component="section" aria-labelledby="pending-h" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
          <Typography id="pending-h" component="h3" sx={{ fontWeight: 700, mb: 2 }}>دعوت‌های در انتظار پاسخ</Typography>
          <Box component="ul" aria-label="دعوت‌های در انتظار" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5 }}>
            {team.invitations.map((i) => (
              <Box key={i.id} component="li" data-testid={`invitation-${i.username}`} sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", p: 1.5, borderRadius: 2.5, bgcolor: "#fffbeb" }}>
                <Box sx={{ flex: "1 1 160px", minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }} noWrap>{i.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    <span dir="ltr">@{i.username}</span> · {ROLE_LABELS[i.role]} · معتبر تا {day(i.expiresAt)}
                  </Typography>
                </Box>
                <Button size="small" color="inherit" sx={{ color: "#9a3412", fontWeight: 700 }} disabled={busy} onClick={() => void act(() => cancelInvitation(storeId, i.id), "دعوت لغو شد.")} aria-label={`لغو دعوت ${i.name}`}>
                  لغو دعوت
                </Button>
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      <Paper variant="outlined" component="section" aria-labelledby="roles-h" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, bgcolor: "#fafbff" }}>
        <Typography id="roles-h" component="h3" sx={{ fontWeight: 700, mb: 1.5 }}>هر نقش چه کاری می‌تواند بکند؟</Typography>
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.25 }}>
          {ROLE_HELP.map((r) => (
            <li key={r.role}>
              <Typography component="p" variant="body2"><strong>{ROLE_LABELS[r.role]}:</strong> {r.text}</Typography>
            </li>
          ))}
        </Box>
      </Paper>

      <Dialog open={!!removing} onClose={() => setRemoving(null)} aria-labelledby="remove-title" aria-describedby="remove-desc">
        <DialogTitle id="remove-title">حذف «{removing?.name}» از تیم؟</DialogTitle>
        <DialogContent>
          <DialogContentText id="remove-desc">دسترسی او به این فروشگاه همین حالا قطع می‌شود. اگر بعداً لازم شد باید دوباره دعوتش کنید.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoving(null)}>انصراف</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={() => {
              const r = removing!;
              setRemoving(null);
              void act(() => removeMember(storeId, r.userId), `«${r.name}» از تیم حذف شد.`);
            }}
          >
            حذف
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
