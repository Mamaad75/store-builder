import { z } from "zod";

/** Longest secret value accepted (phase 2.4). */
export const MAX_SECRET_VALUE = 4096;

/**
 * Request body of "set a secret" (phase 2.4; moved here in 2.5 for the API contract). The value is trimmed of surrounding whitespace
 * (pasted keys often carry a newline); control (Cc), format (Cf: zero-width, bidi overrides) and lone-surrogate (Cs) characters are
 * refused: they hide inside pasted keys.
 */
export const secretValueSchema = z.object({ value: z.string().trim().min(1).max(MAX_SECRET_VALUE).regex(/^[^\p{Cc}\p{Cf}\p{Cs}]*$/u, "نویسه‌ی نامعتبر") }).strict();
