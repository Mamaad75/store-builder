import { z } from "zod";

/**
 * Platform settings managed by super admins (phase 3.1, D31-3). Plain values only; keys and merchant ids are platform SECRETS (write-only,
 * envelope-encrypted) named in PLATFORM_SECRETS. Every group has a full default, so a fresh platform reads as "everything off".
 */
/**
 * Hosts that can only be internal (security review 2026-11-23): localhost, single-label names (compose services), .local/.internal and
 * private, loopback and link-local IP literals. A first filter at save time; the AI client must ALSO resolve and check at call time.
 */
export function isObviouslyInternal(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || !h.includes(".") || /\.(local|internal|localhost)$/.test(h)) return true;
  if (h.includes(":")) return h === "::1" || /^(fc|fd|fe80)/.test(h);
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

const httpsUrl = z
  .string()
  .max(200)
  .refine((v) => {
    if (v === "") return true;
    try {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && !isObviouslyInternal(u.hostname);
    } catch {
      return false;
    }
  }, "یک نشانی https بدون نام کاربری و پارامتر وارد کنید");

export const smsSettingsSchema = z
  .object({
    provider: z.literal("kavenegar"),
    /** Customer sign-in by SMS code (D31-2). Needs the API key and the template; off by default. */
    customerOtpEnabled: z.boolean(),
    /** Name of the OTP template approved in the Kavenegar panel (verify/lookup). */
    otpTemplate: z.string().trim().max(64).regex(/^[A-Za-z0-9_-]*$/, "فقط حروف انگلیسی، عدد، - و _"),
  })
  .strict();

export const paymentSettingsSchema = z
  .object({
    /** Zarinpal for the stores' shoppers (each store enters its own merchant id; phase 3.5). Off by default. */
    zarinpalEnabled: z.boolean(),
    /** Every payment goes to Zarinpal's sandbox (tests, staging). */
    sandbox: z.boolean(),
  })
  .strict();

export const aiSettingsSchema = z
  .object({
    /** Reserved for the AI features of a later phase; nothing calls a model yet. */
    enabled: z.boolean(),
    provider: z.enum(["openai_compatible", "anthropic"]),
    /** API address (https); for an OpenAI-compatible provider, e.g. a domestic gateway. Empty = the provider's default. */
    baseUrl: httpsUrl,
    model: z.string().trim().max(80).regex(/^[A-Za-z0-9._:/-]*$/, "نام مدل نامعتبر است"),
  })
  .strict();

export const PLATFORM_SETTING_SCHEMAS = { sms: smsSettingsSchema, payment: paymentSettingsSchema, ai: aiSettingsSchema } as const;
export type PlatformSettingGroup = keyof typeof PLATFORM_SETTING_SCHEMAS;
export const PLATFORM_SETTING_GROUPS = Object.keys(PLATFORM_SETTING_SCHEMAS) as PlatformSettingGroup[];
export type SmsSettings = z.infer<typeof smsSettingsSchema>;
export type PaymentSettings = z.infer<typeof paymentSettingsSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export interface PlatformSettings {
  sms: SmsSettings;
  payment: PaymentSettings;
  ai: AiSettings;
}

export const PLATFORM_SETTING_DEFAULTS: PlatformSettings = {
  sms: { provider: "kavenegar", customerOtpEnabled: false, otpTemplate: "" },
  payment: { zarinpalEnabled: false, sandbox: true },
  ai: { enabled: false, provider: "openai_compatible", baseUrl: "", model: "" },
};

/** The only platform secrets that exist (an allowlist: no free-form names). */
export const PLATFORM_SECRETS = {
  "sms.kavenegar.api_key": { group: "sms", label: "کلید API کاوه‌نگار" },
  "payment.zarinpal.merchant_id": { group: "payment", label: "مرچنت‌کد زرین‌پال پلتفرم (برای اشتراک فروشنده‌ها)" },
  "ai.api_key": { group: "ai", label: "کلید API هوش مصنوعی" },
} as const satisfies Record<string, { group: PlatformSettingGroup; label: string }>;
export type PlatformSecretName = keyof typeof PLATFORM_SECRETS;
export const isPlatformSecretName = (n: unknown): n is PlatformSecretName => typeof n === "string" && Object.prototype.hasOwnProperty.call(PLATFORM_SECRETS, n);
