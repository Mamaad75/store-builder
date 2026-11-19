import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { TextLink } from "@/components/NextLinks";
import type { Onboarding as OnboardingData } from "@store-builder/shared/modules/stores/onboarding";

export default function Onboarding({ data }: { data: OnboardingData }) {
  return (
    <Paper variant="outlined" component="section" aria-labelledby="onboarding-h" data-testid="onboarding" sx={{ p: 3 }}>
      <Typography id="onboarding-h" variant="h6" component="h2" sx={{ fontWeight: 700 }}>
        شروع سریع{data.storeName ? ` - ${data.storeName}` : ""}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {data.doneCount} از {data.steps.length} مرحله انجام شده است.
      </Typography>
      <Stack component="ol" spacing={1} sx={{ listStyle: "none", m: 0, p: 0 }}>
        {data.steps.map((s) => (
          <Stack key={s.key} component="li" direction="row" spacing={1} sx={{ alignItems: "center" }} data-step={s.key} data-done={s.done}>
            {s.done ? <CheckCircleIcon color="success" fontSize="small" titleAccess="انجام شد" /> : <RadioButtonUncheckedIcon fontSize="small" titleAccess="انجام نشده" />}
            {s.done ? <Typography sx={{ textDecoration: "line-through", color: "text.secondary" }}>{s.label}</Typography> : <TextLink href={s.href}>{s.label}</TextLink>}
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
