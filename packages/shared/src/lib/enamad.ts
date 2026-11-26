import { z } from "zod";

/**
 * The eNamad trust seal (نماد اعتماد الکترونیکی) of a store. The merchant gets a small HTML snippet from the eNamad panel; we never store or
 * render that HTML. We keep only the two values it contains (a numeric `id` and an alphanumeric `Code`) and build the two addresses ourselves
 * on the one eNamad host, so nothing the merchant types can become a script, another host or markup.
 */
export const ENAMAD_ORIGIN = "https://trustseal.enamad.ir";
export const ENAMAD_ID_RE = /^\d{1,10}$/;
export const ENAMAD_CODE_RE = /^[A-Za-z0-9]{8,64}$/;

export const enamadSchema = z
  .object({
    id: z.string().regex(ENAMAD_ID_RE, "شناسهٔ اینماد باید عدد باشد (حداکثر ۱۰ رقم)"),
    code: z.string().regex(ENAMAD_CODE_RE, "کد اینماد باید ۸ تا ۶۴ حرف انگلیسی یا عدد باشد"),
  })
  .strict();
export type Enamad = z.infer<typeof enamadSchema>;

const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";
const ascii = (s: string) => s.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));

/**
 * What a merchant pasted -> the id and code, or null. Accepts the whole snippet, just the address, or "id code" (two values). Anything that
 * looks like a snippet or address must mention enamad; only the two values are read, whatever else the text holds.
 */
export function parseEnamad(input: string): Enamad | null {
  const text = ascii(input).trim();
  if (!text) return null;
  const idM = /[?&;\s"']id=(\d{1,10})(?![\dA-Za-z])/i.exec(text);
  const codeM = /[?&;\s"']code=["']?([A-Za-z0-9]{8,64})(?![A-Za-z0-9])/i.exec(text);
  if (idM && codeM) return /enamad/i.test(text) ? enamadSchema.parse({ id: idM[1], code: codeM[1] }) : null;
  const two = /^(\d{1,10})[\s,;:]+([A-Za-z0-9]{8,64})$/.exec(text);
  return two ? enamadSchema.parse({ id: two[1], code: two[2] }) : null;
}

/** The link (the seal's verification page) and the image address for a validated pair. */
export function enamadLinks(e: Enamad): { href: string; src: string } {
  const q = `id=${e.id}&Code=${e.code}`;
  return { href: `${ENAMAD_ORIGIN}/?${q}`, src: `${ENAMAD_ORIGIN}/logo.aspx?${q}` };
}
