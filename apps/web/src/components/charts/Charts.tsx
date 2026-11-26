"use client";

import { useId, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { compact, dayLabel, fa, fullDayLabel } from "./format";

export interface ChartPoint {
  day: string;
  value: number;
  /** A second line drawn behind the main one (e.g. visitors under page views). */
  value2?: number;
}

const GRID = "#e5e7eb";
/** A "nice" top for the value axis so ticks are round numbers. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const f = max / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

/** x of point i in 0..100, the OLDEST day at the right (the page reads right to left). */
const xOf = (i: number, n: number) => 100 - ((i + 0.5) / n) * 100;
const yOf = (v: number, top: number) => 100 - (v / top) * 100;

interface ChartProps {
  points: ChartPoint[];
  kind: "bar" | "line";
  color: string;
  /** Name of the main series (tooltip, summary and table). */
  label: string;
  label2?: string;
  color2?: string;
  format?: (n: number) => string;
  /** Accessible summary read for the whole chart. */
  summary: string;
  height?: number;
}

/**
 * A responsive SVG chart with no library. The drawing is in a 100x100 box stretched to the container (strokes keep their width), while all
 * text (axis, tooltip) is plain HTML so it stays crisp, translated and right-to-left on phones. The picture is announced by `summary`; the
 * same numbers are available as a table below it for anyone who cannot use the picture.
 */
export function TrendChart({ points, kind, color, label, label2, color2 = "#0891b2", format = fa, summary, height = 190 }: ChartProps) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const top = niceMax(Math.max(0, ...points.map((p) => Math.max(p.value, p.value2 ?? 0))));
  const barW = (100 / n) * 0.62;
  const line = (pick: (p: ChartPoint) => number) => points.map((p, i) => `${xOf(i, n)},${yOf(pick(p), top)}`).join(" ");
  const ticks = [top, top / 2, 0];
  const hp = hover === null ? null : points[hover]!;
  const mid = Math.floor((n - 1) / 2);

  return (
    <Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 1 }}>
        <Box aria-hidden sx={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height, py: 0, color: "text.secondary", fontSize: 11, textAlign: "end", lineHeight: 1 }}>
          {ticks.map((t, i) => (
            <span key={i}>{compact(Math.round(t))}</span>
          ))}
        </Box>
        <Box sx={{ position: "relative", minWidth: 0 }} onPointerLeave={() => setHover(null)}>
          <Box role="img" aria-label={summary}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: "block", width: "100%", height }} aria-hidden focusable="false">
              <defs>
                <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              {ticks.map((t, i) => (
                <line key={i} x1="0" x2="100" y1={yOf(t, top)} y2={yOf(t, top)} stroke={GRID} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              {kind === "bar" &&
                points.map((p, i) => {
                  const h = (p.value / top) * 100;
                  return <rect key={p.day} x={xOf(i, n) - barW / 2} y={100 - h} width={barW} height={Math.max(h, p.value > 0 ? 0.8 : 0)} rx="0.6" fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />;
                })}
              {kind === "line" && p2(points) && <polyline points={line((p) => p.value2 ?? 0)} fill="none" stroke={color2} strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
              {kind === "line" && (
                <>
                  <polygon points={`${xOf(0, n)},100 ${line((p) => p.value)} ${xOf(n - 1, n)},100`} fill={`url(#${id}-fill)`} />
                  <polyline points={line((p) => p.value)} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                </>
              )}
              {hover !== null && <line x1={xOf(hover, n)} x2={xOf(hover, n)} y1="0" y2="100" stroke={color} strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity="0.6" />}
            </svg>
          </Box>
          {/* One invisible column per day: hover (mouse) and tap (touch) show that day's numbers. */}
          <Box aria-hidden sx={{ position: "absolute", inset: 0, display: "flex" }}>
            {points.map((p, i) => (
              <Box key={p.day} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} sx={{ flex: 1, cursor: "crosshair" }} />
            ))}
          </Box>
          {hp && hover !== null && (
            <Box
              aria-hidden
              sx={{
                position: "absolute",
                top: -8,
                insetInlineStart: `${100 - xOf(hover, n)}%`,
                transform: `translate(${xOf(hover, n) > 50 ? "50%" : "-50%"}, -100%)`,
                bgcolor: "#141a33",
                color: "#fff",
                px: 1.25,
                py: 0.75,
                borderRadius: 1.5,
                fontSize: 12,
                lineHeight: 1.6,
                whiteSpace: "nowrap",
                pointerEvents: "none",
                zIndex: 2,
                boxShadow: 3,
              }}
            >
              <div style={{ opacity: 0.8 }}>{fullDayLabel(hp.day)}</div>
              <div>
                <span style={{ color: "#a5b4fc" }}>●</span> {label}: <strong>{format(hp.value)}</strong>
              </div>
              {label2 && hp.value2 !== undefined && (
                <div>
                  <span style={{ color: "#67e8f9" }}>●</span> {label2}: <strong>{format(hp.value2)}</strong>
                </div>
              )}
            </Box>
          )}
          <Box aria-hidden sx={{ display: "flex", justifyContent: "space-between", mt: 0.75, color: "text.secondary", fontSize: 11 }}>
            <span>{dayLabel(points[0]!.day)}</span>
            {n > 4 && <span>{dayLabel(points[mid]!.day)}</span>}
            <span>{dayLabel(points[n - 1]!.day)}</span>
          </Box>
        </Box>
      </Box>
      {label2 && (
        <Box aria-hidden sx={{ display: "flex", gap: 2, mt: 1, fontSize: 12, color: "text.secondary" }}>
          <span><span style={{ color }}>●</span> {label}</span>
          <span><span style={{ color: color2 }}>●</span> {label2}</span>
        </Box>
      )}
      <Box component="details" sx={{ mt: 1, fontSize: 13 }}>
        <Typography component="summary" variant="body2" sx={{ cursor: "pointer", color: "text.secondary", width: "fit-content" }}>جدول داده‌ها</Typography>
        <Box sx={{ maxHeight: 220, overflow: "auto", mt: 1 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{summary}</caption>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: "start", padding: "4px 8px" }}>روز</th>
                <th scope="col" style={{ textAlign: "start", padding: "4px 8px" }}>{label}</th>
                {label2 && <th scope="col" style={{ textAlign: "start", padding: "4px 8px" }}>{label2}</th>}
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.day}>
                  <th scope="row" style={{ textAlign: "start", padding: "4px 8px", fontWeight: 400 }}>{fullDayLabel(p.day)}</th>
                  <td style={{ padding: "4px 8px" }}>{format(p.value)}</td>
                  {label2 && <td style={{ padding: "4px 8px" }}>{format(p.value2 ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      </Box>
    </Box>
  );
}
const p2 = (points: ChartPoint[]) => points.some((p) => p.value2 !== undefined);

/** A tiny trend line for a KPI card: decorative (the number beside it carries the meaning). */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const id = useId();
  const n = values.length;
  const top = Math.max(1, ...values);
  const pts = values.map((v, i) => `${xOf(i, n)},${yOf(v, top) * 0.86 + 7}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 38 }} aria-hidden focusable="false">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${xOf(0, n)},100 ${pts} ${xOf(n - 1, n)},100`} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
