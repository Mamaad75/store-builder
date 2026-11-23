import { z } from "zod";
import { normalizeIranMobile } from "../../lib/phone.js";
import { normalizeFa } from "../../lib/text.js";

/**
 * Customer accounts with a password (owner decision 2026-11-25: both password and SMS-code sign-in). A password account does NOT prove
 * the phone: until the phone is verified by an SMS code, the account sees only orders placed while signed in to it, never orders linked
 * to the phone from guest checkouts. Signing in by SMS code verifies the phone (and drops a password nobody proved owning the phone for).
 */
export const CUSTOMER_PASSWORD_MIN = 8;
export const CUSTOMER_PASSWORD_MAX = 128;

const phone = z.unknown().transform((v, ctx) => {
  const p = normalizeIranMobile(v);
  if (!p) ctx.addIssue({ code: "custom", message: "شماره‌ی موبایل معتبر وارد کنید (مثل ۰۹۱۲۳۴۵۶۷۸۹)." });
  return p ?? "";
});

export const customerRegisterSchema = z
  .object({
    phone,
    name: z
      .string({ error: "نام را وارد کنید" })
      .transform((v) => normalizeFa(v))
      .pipe(z.string().min(2, "نام حداقل ۲ نویسه است").max(80, "نام حداکثر ۸۰ نویسه است").regex(/^[^\p{Cc}\p{Cs}]*$/u, "نام نویسه‌ی نامعتبر دارد")),
    password: z.string({ error: "رمز عبور را وارد کنید" }).min(CUSTOMER_PASSWORD_MIN, `رمز عبور حداقل ${CUSTOMER_PASSWORD_MIN} نویسه است`).max(CUSTOMER_PASSWORD_MAX, "رمز عبور خیلی بلند است"),
  })
  .strict();

export const customerLoginSchema = z
  .object({ phone: z.unknown(), password: z.string().max(CUSTOMER_PASSWORD_MAX).default("") })
  .strict();
