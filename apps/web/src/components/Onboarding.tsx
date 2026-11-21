import CheckRounded from "@mui/icons-material/CheckRounded";
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import RocketLaunchOutlined from "@mui/icons-material/RocketLaunchOutlined";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { LinkButton, TextLink } from "@/components/NextLinks";
import type { Onboarding as OnboardingData } from "@store-builder/shared/modules/stores/onboarding";

const fa = (n: number) => n.toLocaleString("fa-IR");

/**
 * The getting-started stepper: derived from the data (nothing is stored). Done steps are green ticks, the first open step is the
 * highlighted "current" one with a button to continue, later steps are numbered. Horizontal on wide screens, vertical on phones.
 */
export default function Onboarding({ data }: { data: OnboardingData }) {
  const total = data.steps.length;
  const currentIndex = data.steps.findIndex((s) => !s.done);
  const percent = Math.round((data.doneCount / total) * 100);
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-labelledby="onboarding-h"
      data-testid="onboarding"
      sx={{ p: { xs: 2.5, md: 3.5 }, borderRadius: 4, borderColor: "#dfe3f7", background: "linear-gradient(135deg, #f5f6ff 0%, #ffffff 55%)" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mb: 2.5 }}>
        <Box sx={{ width: 44, height: 44, borderRadius: 3, bgcolor: "#4f46e5", color: "#fff", display: "grid", placeItems: "center" }}>
          <RocketLaunchOutlined />
        </Box>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography id="onboarding-h" variant="h6" component="h2" sx={{ fontWeight: 800, lineHeight: 1.4 }}>
            شروع سریع
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {data.storeName ? `فروشگاه «${data.storeName}» را در چند قدم آمادهٔ فروش کنید.` : "با چند قدم ساده فروشگاه خود را راه بیندازید."}
          </Typography>
        </Box>
        <Chip label={`${fa(data.doneCount)} از ${fa(total)} مرحله انجام شده است`} color={data.doneCount === total ? "success" : "primary"} variant="outlined" sx={{ fontWeight: 600 }} />
      </Box>
      <LinearProgress variant="determinate" value={percent} aria-label="پیشرفت راه‌اندازی" sx={{ height: 8, borderRadius: 4, mb: 3.5, bgcolor: "#e6e8fb", "& .MuiLinearProgress-bar": { borderRadius: 4 } }} />
      <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: { xs: "column", md: "row" }, gap: { xs: 0, md: 0 } }}>
        {data.steps.map((s, i) => {
          const current = i === currentIndex;
          const last = i === total - 1;
          return (
            <Box
              key={s.key}
              component="li"
              data-step={s.key}
              data-done={s.done}
              aria-current={current ? "step" : undefined}
              sx={{ flex: 1, position: "relative", display: "flex", flexDirection: { xs: "row", md: "column" }, alignItems: { xs: "flex-start", md: "center" }, gap: { xs: 2, md: 1.25 }, textAlign: { md: "center" }, pb: { xs: last ? 0 : 3, md: 0 } }}
            >
              {!last && (
                <Box
                  aria-hidden
                  sx={{
                    position: "absolute",
                    bgcolor: s.done ? "#16a34a" : "#d7dbf3",
                    // vertical rail under the circle on phones; on wide screens a horizontal rail from this circle towards the next one
                    insetInlineStart: { xs: 19, md: "calc(50% + 20px)" },
                    top: { xs: 42, md: 19 },
                    width: { xs: 2, md: "calc(100% - 40px)" },
                    height: { xs: "calc(100% - 42px)", md: 2 },
                  }}
                />
              )}
              <Box
                aria-hidden
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 800,
                  position: "relative",
                  zIndex: 1,
                  bgcolor: s.done ? "#16a34a" : current ? "#4f46e5" : "#fff",
                  color: s.done || current ? "#fff" : "#6b7280",
                  border: "2px solid",
                  borderColor: s.done ? "#16a34a" : current ? "#4f46e5" : "#d7dbf3",
                  boxShadow: current ? "0 0 0 6px rgba(79,70,229,0.16)" : "none",
                }}
              >
                {s.done ? <CheckRounded fontSize="small" /> : fa(i + 1)}
              </Box>
              <Box sx={{ minWidth: 0, px: { md: 1 } }}>
                {s.done ? (
                  <Typography sx={{ color: "text.secondary", fontWeight: 600 }}>
                    {s.label}
                    <Box component="span" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                      {" "}
                      (انجام شد)
                    </Box>
                  </Typography>
                ) : (
                  <TextLink href={s.href} underline="hover" sx={{ fontWeight: current ? 800 : 600, color: current ? "primary.main" : "text.primary" }}>
                    {s.label}
                  </TextLink>
                )}
                {current && (
                  <Box sx={{ mt: 1 }}>
                    <LinkButton href={s.href} size="small" variant="contained" endIcon={<ArrowBackRounded fontSize="small" />} sx={{ borderRadius: 2.5 }}>
                      ادامه
                    </LinkButton>
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
