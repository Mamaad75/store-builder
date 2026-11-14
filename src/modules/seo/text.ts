/** Pure text helpers for search-result and link-preview text. No I/O. */

/** Collapses all whitespace (including newlines) to single spaces and removes control characters. */
export function cleanText(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Shortens to at most `max` characters (counted in code points, so Persian and emoji are not split), preferring a word
 * boundary when one exists in the last 40% of the text, and appends an ellipsis when something was cut.
 */
export function clip(input: string, max = 160): string {
  const text = cleanText(input);
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let cut = chars.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace >= Math.floor(max * 0.6)) cut = cut.slice(0, lastSpace);
  return `${cut.join("").trimEnd()}…`;
}
