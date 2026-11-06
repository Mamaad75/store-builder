/** Relative luminance (WCAG) of a #RRGGBB colour, 0..1. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** Text colour (white or near-black) with the better contrast on the given background. */
export function readableTextOn(hex: string): "#ffffff" | "#111827" {
  const l = luminance(hex);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastDark = (l + 0.05) / (luminance("#111827") + 0.05);
  return contrastWhite >= contrastDark ? "#ffffff" : "#111827";
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
