/**
 * Free text typed by a person (support messages, reviews, blog posts): Unicode-normalised, control characters and bidi overrides removed
 * (they can reorder or hide text), ends trimmed. Line breaks and tabs are kept.
 */
export const cleanText = (v: string): string => v.normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‎‏‪-‮⁦-⁩]/g, "").trim();
