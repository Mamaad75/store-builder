import { z } from "zod";

/**
 * Usernames (ADR 0001, U1): lower-case a-z, 0-9 and "_", start with a letter, 3-30 characters. The database CHECK
 * "User_username_format" enforces the same pattern. Input is normalised first: surrounding spaces removed, Persian and Arabic-Indic
 * digits turned into ASCII digits, letters lower-cased, so "Ali_۱۲" and "ali_12" are the same account.
 */
export const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,29}$/;

/** Names that could impersonate the platform or collide with routes/subdomains; refused at registration. */
export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "system", "support", "help", "info", "contact", "security", "abuse", "postmaster", "webmaster",
  "api", "www", "mail", "app", "dashboard", "login", "logout", "register", "signup", "signin", "account", "settings", "preview",
  "store", "stores", "shop", "null", "undefined", "anonymous", "owner", "staff", "moderator", "test",
]);

export function normalizeUsername(value: string): string {
  return value
    .trim()
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase();
}

const username = z
  .string()
  .max(64)
  .transform(normalizeUsername)
  .pipe(
    z
      .string()
      .min(3, "نام کاربری باید حداقل ۳ کاراکتر باشد")
      .max(30, "نام کاربری حداکثر ۳۰ کاراکتر می‌تواند باشد")
      .regex(USERNAME_PATTERN, "نام کاربری فقط می‌تواند حروف انگلیسی، عدد و _ داشته باشد و باید با حرف شروع شود"),
  );

export const registerSchema = z.object({
  name: z.string().trim().min(1, "نام را وارد کنید").max(80),
  username: username.refine((u) => !RESERVED_USERNAMES.has(u), "این نام کاربری قابل استفاده نیست"),
  // Max length bounds Argon2 work per request.
  password: z.string().min(8, "رمز عبور باید حداقل ۸ کاراکتر باشد").max(128),
});

/** Login only normalises: any malformed name simply gets the same generic "invalid" outcome as a wrong password. */
export const loginSchema = z.object({
  username: z.string().max(64).transform(normalizeUsername),
  password: z.string().min(1).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

const newPassword = z.string().min(8, "رمز عبور باید حداقل ۸ کاراکتر باشد").max(128, "رمز عبور حداکثر ۱۲۸ کاراکتر می‌تواند باشد");

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "رمز عبور فعلی را وارد کنید").max(128), newPassword })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ["newPassword"], message: "رمز عبور جدید باید با رمز فعلی متفاوت باشد" });
