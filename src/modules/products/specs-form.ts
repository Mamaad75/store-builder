/** The part of FormData the parser needs (so it can be tested without a browser or Next.js). */
export interface FormLike {
  get(name: string): unknown;
  getAll(name: string): unknown[];
}

/**
 * Specs from the product form. `specsIntent` decides whether the product's specs are part of the update at all:
 *  - "replace" -> the rows (label/value pairs; a row WITHOUT a value is skipped, so a preset can be filled in part)
 *  - "clear"   -> an explicit empty list (the owner chose to remove invalid stored specs)
 *  - anything else ("keep", missing, forged) -> `undefined`: the specs are NOT part of the update and stay exactly as
 *    stored, whatever they contain. Only the two explicit intents can change them.
 * A row with a value but no label is passed on (with an empty label) so validation reports it to the owner.
 */
export function specsFromForm(fd: FormLike): { label: string; value: string }[] | undefined {
  const intent = fd.get("specsIntent");
  if (intent === "clear") return [];
  if (intent !== "replace") return undefined;
  const labels = fd.getAll("specLabel");
  const values = fd.getAll("specValue");
  const rows: { label: string; value: string }[] = [];
  for (let i = 0; i < Math.min(labels.length, values.length, 200); i++) {
    const label = typeof labels[i] === "string" ? (labels[i] as string) : "";
    const value = typeof values[i] === "string" ? (values[i] as string) : "";
    if (value.trim() === "") continue;
    rows.push({ label, value });
  }
  return rows;
}
