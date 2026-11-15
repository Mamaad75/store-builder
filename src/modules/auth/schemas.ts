import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());

export const registerSchema = z.object({
  name: z.string().trim().min(1, "نام را وارد کنید").max(80),
  email,
  // Max length bounds Argon2 work per request.
  password: z.string().min(8, "رمز عبور باید حداقل ۸ کاراکتر باشد").max(128),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

const newPassword = z.string().min(8, "رمز عبور باید حداقل ۸ کاراکتر باشد").max(128, "رمز عبور حداکثر ۱۲۸ کاراکتر می‌تواند باشد");

export const forgotPasswordSchema = z.object({ email });

/** The raw token is 32 random bytes, base64url (43 characters); anything else is rejected before touching the database. */
export const resetPasswordSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "لینک بازیابی نامعتبر است."),
  password: newPassword,
});

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "رمز عبور فعلی را وارد کنید").max(128), newPassword })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ["newPassword"], message: "رمز عبور جدید باید با رمز فعلی متفاوت باشد" });
