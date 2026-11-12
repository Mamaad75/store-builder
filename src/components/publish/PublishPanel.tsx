"use client";

import { useActionState, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { claimSubdomainAction, publishAction, setLiveVersionAction, unpublishAction, type PublishState } from "@/app/dashboard/publish-actions";

export interface PublishPanelProps {
  storeId: string;
  status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  draftRevision: number;
  liveNumber: number | null;
  mayHaveUnpublishedChanges: boolean;
  subdomain: string | null;
  liveUrl: string | null;
  reserved: { host: string; until: string }[];
  versions: { number: number; createdAt: string; snapshotBytes: number }[];
}

const fa = (n: number) => n.toLocaleString("fa-IR");
const fmt = (iso: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const kb = (b: number) => `${fa(Math.max(1, Math.round(b / 1024)))} کیلوبایت`;

function Messages({ state }: { state: PublishState }) {
  return (
    <>
      {state.error && <Alert severity="error" data-testid="publish-error">{state.error}</Alert>}
      {state.success && <Alert severity="success" data-testid="publish-success">{state.success}</Alert>}
    </>
  );
}

export default function PublishPanel(p: PublishPanelProps) {
  const [claimState, claim, claiming] = useActionState<PublishState, FormData>(claimSubdomainAction, {});
  const [pubState, publish, publishing] = useActionState<PublishState, FormData>(publishAction, {});
  const [offState, unpublish, unpublishing] = useActionState<PublishState, FormData>(unpublishAction, {});
  const [liveState, setLive, switching] = useActionState<PublishState, FormData>(setLiveVersionAction, {});
  const [label, setLabel] = useState(p.subdomain ?? "");
  const live = p.status === "PUBLISHED";
  const busy = claiming || publishing || unpublishing || switching;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="h6" component="h2">وضعیت انتشار</Typography>
        <Chip size="small" color={live ? "success" : "default"} label={live ? `منتشرشده (نسخهٔ ${fa(p.liveNumber ?? 0)})` : p.status === "UNPUBLISHED" ? "خارج از دسترس" : "هنوز منتشر نشده"} data-testid="publish-status" />
        {live && p.mayHaveUnpublishedChanges && <Chip size="small" color="warning" label="تغییرات منتشرنشده دارد" />}
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5} component="form" action={claim}>
          <Typography sx={{ fontWeight: 700 }}>زیردامنه</Typography>
          <Typography variant="body2" color="text.secondary">
            {p.subdomain ? <>نشانی فعلی: <bdi dir="ltr" data-testid="current-subdomain">{p.liveUrl}</bdi></> : "برای انتشار، ابتدا یک زیردامنه ثبت کنید."}
          </Typography>
          <input type="hidden" name="storeId" value={p.storeId} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField name="label" size="small" label="زیردامنه" value={label} onChange={(e) => setLabel(e.target.value)} slotProps={{ htmlInput: { dir: "ltr", autoCapitalize: "none", spellCheck: false, "data-testid": "subdomain-input" } }} />
            <Button type="submit" variant="outlined" disabled={busy}>{p.subdomain ? "تغییر زیردامنه" : "ثبت زیردامنه"}</Button>
          </Stack>
          {p.subdomain && live && (
            <FormControlLabel control={<Checkbox name="confirmChange" value="true" />} label="تغییر را تأیید می‌کنم؛ نشانی قبلی بلافاصله از کار می‌افتد" />
          )}
          {p.reserved.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              زیردامنه‌های آزادشدهٔ رزروشده: {p.reserved.map((r) => `${r.host} (تا ${fmt(r.until)})`).join("، ")}
            </Typography>
          )}
          <Messages state={claimState} />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Typography sx={{ fontWeight: 700 }}>انتشار پیش‌نویس</Typography>
          <Typography variant="body2" color="text.secondary">
            با انتشار، یک نسخهٔ تغییرناپذیر از پیش‌نویس فعلی ساخته و زنده می‌شود. ویرایش‌های بعدی پیش‌نویس تا انتشار بعدی روی سایت اثری ندارد.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            <form action={publish}>
              <input type="hidden" name="storeId" value={p.storeId} />
              <input type="hidden" name="expectedDraftRevision" value={p.draftRevision} />
              <Button type="submit" variant="contained" disabled={busy || !p.subdomain} data-testid="publish-button">انتشار</Button>
            </form>
            {live && (
              <form action={unpublish}>
                <input type="hidden" name="storeId" value={p.storeId} />
                <Button type="submit" color="warning" variant="outlined" disabled={busy} data-testid="unpublish-button">لغو انتشار</Button>
              </form>
            )}
          </Stack>
          <Messages state={pubState} />
          <Messages state={offState} />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Typography sx={{ fontWeight: 700 }}>نسخه‌ها</Typography>
          {p.versions.length === 0 && <Typography variant="body2" color="text.secondary">هنوز نسخه‌ای منتشر نشده است.</Typography>}
          {p.versions.map((v) => {
            const isLive = live && v.number === p.liveNumber;
            return (
              <Stack key={v.number} direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }} data-testid="version-row" data-version={v.number}>
                <Typography variant="body2">
                  نسخهٔ {fa(v.number)} · {fmt(v.createdAt)} · {kb(v.snapshotBytes)} {isLive && <Chip size="small" color="success" label="زنده" />}
                </Typography>
                {!isLive && (
                  <form action={setLive}>
                    <input type="hidden" name="storeId" value={p.storeId} />
                    <input type="hidden" name="versionNumber" value={v.number} />
                    <input type="hidden" name="mode" value={live ? "rollback" : "republish"} />
                    <Button type="submit" size="small" variant="outlined" disabled={busy || (!live && !p.subdomain)} data-testid="set-live-button">
                      {live ? "بازگشت به این نسخه" : "انتشار دوبارهٔ این نسخه"}
                    </Button>
                  </form>
                )}
              </Stack>
            );
          })}
          <Messages state={liveState} />
        </Stack>
      </Paper>
    </Stack>
  );
}
