"use client";

import ArrowDropDownRounded from "@mui/icons-material/ArrowDropDownRounded";
import ArrowDropUpRounded from "@mui/icons-material/ArrowDropUpRounded";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { changePercent } from "@store-builder/shared/modules/analytics/analytics";
import { Sparkline } from "./Charts";
import { fa } from "./format";

export function Delta({ current, previous }: { current: number; previous: number }) {
  const c = changePercent(current, previous);
  if (c === null) return <Typography variant="caption" color="text.secondary">بدون مقایسه با دورهٔ قبل</Typography>;
  const up = c >= 0;
  return (
    <Typography variant="caption" sx={{ display: "inline-flex", alignItems: "center", fontWeight: 700, color: c === 0 ? "text.secondary" : up ? "#15803d" : "#b91c1c" }}>
      {c === 0 ? null : up ? <ArrowDropUpRounded fontSize="small" aria-hidden /> : <ArrowDropDownRounded fontSize="small" aria-hidden />}
      <span dir="ltr">{fa(Math.abs(c))}٪</span>
      <Box component="span" sx={{ color: "text.secondary", fontWeight: 400, marginInlineStart: 0.5 }}>نسبت به دورهٔ قبل</Box>
    </Typography>
  );
}

export function Kpi({ title, value, sub, current, previous, series, color, testId }: { title: string; value: string; sub?: string; current: number; previous: number; series: number[]; color: string; testId: string }) {
  return (
    <Paper variant="outlined" data-testid={testId} sx={{ p: 2, borderRadius: 3, display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">{title}</Typography>
      <Typography component="p" sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 800, lineHeight: 1.3 }}>{value}</Typography>
      <Box sx={{ minHeight: 20 }}><Delta current={current} previous={previous} /></Box>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      <Box sx={{ mt: "auto", pt: 1 }}><Sparkline values={series} color={color} /></Box>
    </Paper>
  );
}

export function ChartCard({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return (
    <Paper variant="outlined" component="section" aria-label={title} data-testid={testId} sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3, minWidth: 0 }}>
      <Typography component="h3" sx={{ fontWeight: 700, mb: 2 }}>{title}</Typography>
      {children}
    </Paper>
  );
}

