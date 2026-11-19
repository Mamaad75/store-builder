import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ThemeRef } from "@/modules/stores/theme-switch";

/** The themes the owner may use. Choosing one only opens the compatibility report (nothing is applied by a click here). */
export default function ThemePicker({ storeId, current, themes, selected }: { storeId: string; current: ThemeRef | null; themes: ThemeRef[]; selected: string | null }) {
  const id = encodeURIComponent(storeId);
  return (
    <Stack spacing={1.5} data-testid="theme-picker">
      {themes.map((t) => {
        const isCurrent = current?.key === t.key;
        return (
          <Paper key={t.key} variant="outlined" sx={{ p: 2, borderColor: selected === t.key ? "primary.main" : undefined }} data-testid="theme-card" data-theme-key={t.key} data-current={isCurrent ? "yes" : "no"}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
              <Stack spacing={0.5}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography sx={{ fontWeight: 700 }}>{t.name}</Typography>
                  {isCurrent && <Chip size="small" color="primary" label="قالب فعلی" />}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {t.description}
                </Typography>
              </Stack>
              {!isCurrent && (
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                  <Button component="a" href={`/preview/${id}?theme=${encodeURIComponent(t.key)}`} target="_blank" rel="noopener" size="small" variant="outlined" data-testid="theme-preview-link">
                    پیش‌نمایش
                  </Button>
                  <Button component="a" href={`/dashboard/stores/${id}/appearance?target=${encodeURIComponent(t.key)}#theme-switch`} size="small" variant="contained" data-testid="theme-check-link">
                    بررسی سازگاری
                  </Button>
                </Stack>
              )}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
