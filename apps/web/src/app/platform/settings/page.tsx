import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { AiSettingsForm, PaymentSettingsForm, RatesSettingsForm, SmsSettingsForm } from "@/components/platform/PlatformForms";
import { getPlatformSettings } from "@/gateway/platform";

export default async function PlatformSettingsPage() {
  const v = await getPlatformSettings();
  return (
    <>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
        تنظیمات پلتفرم
      </Typography>
      <Typography sx={{ color: "text.secondary", mb: 3 }}>کلیدها رمزنگاری‌شده ذخیره می‌شوند و فقط «تنظیم شده» یا «نشده» دیده می‌شوند؛ هیچ مقداری دوباره نمایش داده نمی‌شود.</Typography>
      {!v.encryptionReady && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          کلید اصلی رمزنگاری روی سرور تنظیم نشده است (SECRETS_MASTER_KEYS و SECRETS_ACTIVE_KEY_ID). تا آن موقع می‌توانید تنظیمات را ذخیره کنید، ولی کلیدهای API ذخیره نمی‌شوند.
        </Alert>
      )}
      <Stack spacing={3}>
        <SmsSettingsForm initial={v.settings.sms} secrets={v.secrets} encryptionReady={v.encryptionReady} />
        <PaymentSettingsForm initial={v.settings.payment} secrets={v.secrets} encryptionReady={v.encryptionReady} />
        <RatesSettingsForm initial={v.settings.rates} secrets={v.secrets} encryptionReady={v.encryptionReady} />
        <AiSettingsForm initial={v.settings.ai} secrets={v.secrets} encryptionReady={v.encryptionReady} />
      </Stack>
    </>
  );
}
