"use client";

import { useActionState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { pageEditAction, type EditorState } from "@/app/dashboard/pages-actions";

export interface PageRowProps {
  type: string;
  slug: string;
  title: string;
  isVisible: boolean;
  canHide: boolean;
  revision: number;
  sectionCount: number;
  invalidCount: number;
  href: string;
}

export default function PagesList({ storeId, pages }: { storeId: string; pages: PageRowProps[] }) {
  const [state, act, pending] = useActionState<EditorState, FormData>(pageEditAction, {});
  return (
    <Stack spacing={1.5}>
      {state.error && <Alert severity="error">{state.error}</Alert>}
      {state.success && <Alert severity="success">{state.success}</Alert>}
      {pages.map((p) => (
        <Paper key={`${p.type}-${p.revision}`} variant="outlined" sx={{ p: 2 }} data-testid="page-row" data-page-type={p.type}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
            <Stack spacing={0.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography sx={{ fontWeight: 700 }}>{p.title}</Typography>
                {!p.isVisible && <Chip size="small" label="پنهان" />}
                {p.invalidCount > 0 && <Chip size="small" color="warning" label="نیاز به بازیابی" />}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {p.sectionCount.toLocaleString("fa-IR")} بخش
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              <Button component="a" href={p.href} size="small" variant="contained">
                ویرایش
              </Button>
              <form action={act}>
                <input type="hidden" name="storeId" value={storeId} />
                <input type="hidden" name="pageType" value={p.type} />
                <input type="hidden" name="expectedRevision" value={p.revision} />
                <input type="hidden" name="intent" value="visibility" />
                <input type="hidden" name="visible" value={p.isVisible ? "false" : "true"} />
                <Button type="submit" size="small" variant="outlined" disabled={pending || !p.canHide || p.invalidCount > 0} title={!p.canHide ? "این صفحه همیشه نمایش داده می‌شود" : undefined}>
                  {p.isVisible ? "پنهان‌کردن" : "نمایش"}
                </Button>
              </form>
            </Stack>
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}
