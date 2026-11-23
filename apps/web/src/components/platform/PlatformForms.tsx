"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { PlatformAdminConflictError } from "@store-builder/shared/modules/platform/errors";
import { SecretsUnavailableError } from "@store-builder/shared/modules/secrets/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { grantPlatformAdmin, removePlatformSecret, revokePlatformAdmin, setPlatformSecret, updatePlatformSettings } from "@/client/platform-api";
import { transportState } from "@/client/guard";

type Feedback = { ok?: string; error?: string; fieldErrors?: Record<string, string[]> };
const ltr = { htmlInput: { dir: "ltr" as const } };

/** One error-to-message mapping for every form on these pages (nothing technical is shown). */
function feedbackOf(e: unknown): Feedback {
  const t = transportState(e);
  if (t) return t;
  if (e instanceof ValidationError) return { error: "مقدارها را بررسی کنید.", fieldErrors: e.fieldErrors };
  if (e instanceof SecretsUnavailableError) return { error: "کلید اصلی رمزنگاری روی سرور تنظیم نشده است (SECRETS_MASTER_KEYS)؛ ذخیره‌ی کلیدها ممکن نیست." };
  if (e instanceof PlatformAdminConflictError) return { error: e.message };
  if (e instanceof NotFoundError) return { error: "پیدا نشد." };
  return { error: "ذخیره ممکن نشد. دوباره امتحان کنید." };
}

function useSubmit() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fb, setFb] = useState<Feedback>({});
  const run = (work: () => Promise<unknown>, ok: string) =>
    start(async () => {
      try {
        await work();
        setFb({ ok });
        router.refresh();
      } catch (e) {
        setFb(feedbackOf(e));
      }
    });
  return { pending, fb, run };
}

function Section({ title, description, badge, children }: { title: string; description: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <Card variant="outlined" component="section" aria-label={title}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
          <Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>
            {title}
          </Typography>
          {badge}
        </Stack>
        <Typography sx={{ color: "text.secondary", mb: 2 }}>{description}</Typography>
        {children}
      </CardContent>
    </Card>
  );
}

function Status({ fb }: { fb: Feedback }) {
  if (fb.error) return <Alert severity="error" role="alert">{fb.error}</Alert>;
  if (fb.ok) return <Alert severity="success" role="status">{fb.ok}</Alert>;
  return null;
}

/** A write-only secret: shows whether it is set (and the last 4 characters of long values); the value is never sent back. */
export function SecretField({ name, label, state, disabled }: { name: string; label: string; state: { configured: boolean; hint: string | null }; disabled: boolean }) {
  const { pending, fb, run } = useSubmit();
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await setPlatformSecret(name, value);
      setValue("");
    }, "ذخیره شد.");
  };
  return (
    <Box component="form" onSubmit={submit} noValidate sx={{ mt: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography sx={{ fontWeight: 700 }}>{label}</Typography>
          {state.configured ? <Chip size="small" color="success" label={state.hint ? `تنظیم شده (…${state.hint})` : "تنظیم شده"} /> : <Chip size="small" label="تنظیم نشده" />}
        </Stack>
        <TextField
          type="password"
          autoComplete="off"
          label={state.configured ? "مقدار جدید (جایگزین مقدار فعلی)" : "مقدار"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled || pending}
          error={!!fb.fieldErrors?.value}
          helperText={fb.fieldErrors?.value?.[0] ?? "فقط ذخیره می‌شود؛ هیچ‌جا دوباره نمایش داده نمی‌شود."}
          slotProps={ltr}
        />
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" disabled={disabled || pending || value.trim() === ""}>
            ذخیره‌ی کلید
          </Button>
          {state.configured && (
            <Button type="button" color="error" disabled={pending} onClick={() => run(() => removePlatformSecret(name), "حذف شد.")}>
              حذف
            </Button>
          )}
        </Stack>
        <Status fb={fb} />
      </Stack>
    </Box>
  );
}

type Secrets = Record<string, { configured: boolean; hint: string | null }>;

export function SmsSettingsForm({ initial, secrets, encryptionReady }: { initial: { customerOtpEnabled: boolean; otpTemplate: string }; secrets: Secrets; encryptionReady: boolean }) {
  const { pending, fb, run } = useSubmit();
  const [enabled, setEnabled] = useState(initial.customerOtpEnabled);
  const [template, setTemplate] = useState(initial.otpTemplate);
  const ready = secrets["sms.kavenegar.api_key"]?.configured && template.trim() !== "";
  return (
    <Section
      title="پنل پیامک (کاوه‌نگار)"
      description="ورود مشتری‌ها با کد یکبارمصرف. تا وقتی کلید API و نام قالب تأییدشده در پنل کاوه‌نگار ثبت و سوییچ روشن نشود، ورود با پیامک خاموش می‌ماند."
      badge={<Chip size="small" color={initial.customerOtpEnabled ? "success" : "default"} label={initial.customerOtpEnabled ? "روشن" : "خاموش"} />}
    >
      <Box
        component="form"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          run(() => updatePlatformSettings("sms", { provider: "kavenegar", customerOtpEnabled: enabled, otpTemplate: template }), "تنظیمات پیامک ذخیره شد.");
        }}
      >
        <Stack spacing={2}>
          <TextField label="نام قالب کد ورود (verify/lookup)" value={template} onChange={(e) => setTemplate(e.target.value)} error={!!fb.fieldErrors?.otpTemplate} helperText={fb.fieldErrors?.otpTemplate?.[0] ?? "همان نامی که در پنل کاوه‌نگار برای قالب کد تأیید ساخته‌اید."} slotProps={ltr} />
          <FormControlLabel control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />} label="ورود مشتری با پیامک فعال باشد" />
          {enabled && !ready && <Alert severity="warning">تا وقتی کلید API و نام قالب ثبت نشود، ورود با پیامک عملاً خاموش می‌ماند.</Alert>}
          <Box>
            <Button type="submit" variant="contained" disabled={pending}>
              ذخیره
            </Button>
          </Box>
          <Status fb={fb} />
        </Stack>
      </Box>
      <SecretField name="sms.kavenegar.api_key" label="کلید API کاوه‌نگار" state={secrets["sms.kavenegar.api_key"]!} disabled={!encryptionReady} />
    </Section>
  );
}

export function PaymentSettingsForm({ initial, secrets, encryptionReady }: { initial: { zarinpalEnabled: boolean; sandbox: boolean }; secrets: Secrets; encryptionReady: boolean }) {
  const { pending, fb, run } = useSubmit();
  const [enabled, setEnabled] = useState(initial.zarinpalEnabled);
  const [sandbox, setSandbox] = useState(initial.sandbox);
  return (
    <Section
      title="درگاه پرداخت (زرین‌پال)"
      description="پرداخت مشتری‌ها مستقیم به حساب هر فروشنده می‌رود (هر فروشگاه مرچنت‌کد خودش را در تنظیمات فروشگاه وارد می‌کند). اینجا روشن یا خاموش بودن درگاه برای همه‌ی فروشگاه‌ها، حالت آزمایشی (sandbox) و مرچنت‌کد خود پلتفرم برای دریافت اشتراک فروشنده‌ها تنظیم می‌شود."
      badge={<Chip size="small" color={initial.zarinpalEnabled ? "success" : "default"} label={initial.zarinpalEnabled ? "روشن" : "خاموش"} />}
    >
      <Box
        component="form"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          run(() => updatePlatformSettings("payment", { zarinpalEnabled: enabled, sandbox }), "تنظیمات پرداخت ذخیره شد.");
        }}
      >
        <Stack spacing={1}>
          <FormControlLabel control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />} label="پرداخت با زرین‌پال برای فروشگاه‌ها فعال باشد" />
          <FormControlLabel control={<Switch checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />} label="حالت آزمایشی (sandbox): هیچ پولی جابه‌جا نمی‌شود" />
          <Box>
            <Button type="submit" variant="contained" disabled={pending}>
              ذخیره
            </Button>
          </Box>
          <Status fb={fb} />
        </Stack>
      </Box>
      <SecretField name="payment.zarinpal.merchant_id" label="مرچنت‌کد زرین‌پال پلتفرم" state={secrets["payment.zarinpal.merchant_id"]!} disabled={!encryptionReady} />
    </Section>
  );
}

export function AiSettingsForm({ initial, secrets, encryptionReady }: { initial: { enabled: boolean; provider: "openai_compatible" | "anthropic"; baseUrl: string; model: string }; secrets: Secrets; encryptionReady: boolean }) {
  const { pending, fb, run } = useSubmit();
  const [v, setV] = useState(initial);
  return (
    <Section
      title="هوش مصنوعی"
      description="برای امکانات هوش مصنوعی مراحل بعد (مثل نوشتن توضیح محصول). فعلاً فقط تنظیمات ذخیره می‌شود و هیچ مدلی صدا زده نمی‌شود."
      badge={<Chip size="small" label="مرحله‌ی بعد" />}
    >
      <Box
        component="form"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          run(() => updatePlatformSettings("ai", v), "تنظیمات هوش مصنوعی ذخیره شد.");
        }}
      >
        <Stack spacing={2}>
          <TextField select label="سرویس‌دهنده" value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value as typeof v.provider })}>
            <MenuItem value="openai_compatible">سازگار با OpenAI (مثلاً یک درگاه داخلی)</MenuItem>
            <MenuItem value="anthropic">Anthropic</MenuItem>
          </TextField>
          <TextField label="نشانی API (https؛ خالی = پیش‌فرض سرویس‌دهنده)" value={v.baseUrl} onChange={(e) => setV({ ...v, baseUrl: e.target.value })} error={!!fb.fieldErrors?.baseUrl} helperText={fb.fieldErrors?.baseUrl?.[0]} slotProps={ltr} />
          <TextField label="نام مدل" value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} error={!!fb.fieldErrors?.model} helperText={fb.fieldErrors?.model?.[0]} slotProps={ltr} />
          <FormControlLabel control={<Switch checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />} label="فعال (برای مراحل بعد)" />
          <Box>
            <Button type="submit" variant="contained" disabled={pending}>
              ذخیره
            </Button>
          </Box>
          <Status fb={fb} />
        </Stack>
      </Box>
      <SecretField name="ai.api_key" label="کلید API هوش مصنوعی" state={secrets["ai.api_key"]!} disabled={!encryptionReady} />
    </Section>
  );
}

export function GrantAdminForm() {
  const { pending, fb, run } = useSubmit();
  const [username, setUsername] = useState("");
  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        run(async () => {
          await grantPlatformAdmin(username);
          setUsername("");
        }, "مدیر جدید اضافه شد.");
      }}
    >
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-start" } }}>
        <TextField label="نام کاربری یک حساب موجود" value={username} onChange={(e) => setUsername(e.target.value)} error={!!fb.fieldErrors?.username} helperText={fb.fieldErrors?.username?.[0]} slotProps={ltr} />
        <Button type="submit" variant="contained" disabled={pending || username.trim() === ""} sx={{ minHeight: 56 }}>
          افزودن مدیر
        </Button>
      </Stack>
      <Box sx={{ mt: 1 }}>
        <Status fb={fb} />
      </Box>
    </Box>
  );
}

export function RevokeAdminButton({ userId, username, self }: { userId: string; username: string; self: boolean }) {
  const { pending, fb, run } = useSubmit();
  if (self) return <Chip size="small" label="شما" />;
  return (
    <>
      <Button size="small" color="error" disabled={pending} onClick={() => window.confirm(`دسترسی مدیر «${username}» حذف شود؟`) && run(() => revokePlatformAdmin(userId), "حذف شد.")}>
        حذف دسترسی
      </Button>
      {fb.error && <Typography role="alert" sx={{ color: "error.main", fontSize: 13 }}>{fb.error}</Typography>}
    </>
  );
}
