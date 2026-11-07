/** Pure parsers for the plain-text props of theme-specific sections (output is rendered as escaped React text). */

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** "label: value" per line (split at the first colon); lines without a colon become value-only rows. At most 14 rows. */
export function parseLabelLines(body: string): { label: string; value: string }[] {
  return body
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean)
    .slice(0, 14)
    .map((line) => {
      const m = line.match(/^([^:：]{1,60})[:：]\s*(.*)$/);
      return m ? { label: clean(m[1]!), value: clean(m[2]!) } : { label: "", value: line };
    });
}

/** First line = header, `|` separates columns. At most 12 rows x 6 columns; ragged rows are padded. */
export function parseTable(table: string): { head: string[]; rows: string[][] } | null {
  const lines = table
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 13);
  if (lines.length < 2) return null;
  const split = (l: string) => l.split("|").map(clean).slice(0, 6);
  const head = split(lines[0]!);
  const rows = lines.slice(1).map((l) => {
    const cells = split(l);
    while (cells.length < head.length) cells.push("");
    return cells;
  });
  return { head, rows };
}
