import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AppearanceForm from "@/components/pages/AppearanceForm";
import { requireUser } from "@/modules/auth/session";
import { NotFoundError } from "@/modules/stores/errors";
import Alert from "@mui/material/Alert";
import ThemePicker from "@/components/pages/ThemePicker";
import ThemeSwitchPanel from "@/components/pages/ThemeSwitchPanel";
import { ValidationError } from "@/modules/stores/errors";
import { getStore } from "@/modules/stores/service";
import { listSwitchableThemes, previewThemeSwitch, type ThemeSwitchReport } from "@/modules/stores/theme-switch";
import { getSectionDefinition } from "@/templates/section-registry";
import { templateSettingsSchema } from "@/templates/sections";

export const metadata: Metadata = { title: "ظاهر فروشگاه" };

export default async function AppearancePage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const { storeId } = await params;
  let store;
  try {
    store = await getStore(user.id, storeId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const settings = templateSettingsSchema.parse(store.settings);
  const sp = await searchParams;
  const target = typeof sp.target === "string" ? sp.target : null;
  const switched = typeof sp.switched === "string" ? sp.switched : null;
  const { current, themes } = await listSwitchableThemes(user.id, storeId);
  let report: ThemeSwitchReport | null = null;
  let reportError: string | null = null;
  if (target) {
    try {
      report = await previewThemeSwitch(user.id, storeId, target);
    } catch (e) {
      if (e instanceof ValidationError) reportError = "این قالب در دسترس نیست.";
      else if (e instanceof NotFoundError) notFound();
      else throw e;
    }
  }
  const sectionLabels: Record<string, string> = {};
  for (const p of report?.pages ?? []) {
    for (const e of p.entries) if (e.type) sectionLabels[e.type] = getSectionDefinition(e.type)?.label ?? e.type;
    for (const m of p.missingRequired) sectionLabels[m.type] = getSectionDefinition(m.type)?.label ?? m.type;
  }
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 } }}>
      <Stack spacing={3}>
        <Typography variant="body2" color="text.secondary">
          رنگ و تایپوگرافی فروشگاه. تغییرات فقط روی پیش‌نویس اعمال می‌شود؛ از «پیش‌نمایش پیش‌نویس» آن را ببینید.
        </Typography>
        <AppearanceForm
          storeId={store.id}
          primaryColor={settings.primaryColor}
          sizeScale={settings.typography.sizeScale}
          headingWeight={settings.typography.headingWeight}
          bodyWeight={settings.typography.bodyWeight}
        />
        <Stack spacing={2} id="theme-switch" data-testid="theme-section">
          <Typography variant="h6" component="h2">
            قالب فروشگاه
          </Typography>
          <Typography variant="body2" color="text.secondary">
            قالب فقط ظاهر پیش‌نویس را تعیین می‌کند؛ محتوای شما (صفحه‌ها، محصولات، تصاویر) مستقل از قالب نگه‌داری می‌شود. پیش از هر تغییر، گزارش سازگاری را ببینید.
          </Typography>
          {switched && (
            <Alert severity="success" data-testid="switch-success">
              قالب پیش‌نویس تغییر کرد. فروشگاه منتشرشده (در صورت وجود) تغییری نکرده است.
            </Alert>
          )}
          <ThemePicker storeId={store.id} current={current} themes={themes} selected={report?.target.key ?? null} />
          {reportError && <Alert severity="warning" data-testid="theme-report-error">{reportError}</Alert>}
          {report && report.sameTheme && <Alert severity="info" data-testid="theme-same">فروشگاه هم‌اکنون از این قالب استفاده می‌کند.</Alert>}
          {report && !report.sameTheme && <ThemeSwitchPanel report={report} sectionLabels={sectionLabels} />}
        </Stack>
      </Stack>
    </Paper>
  );
}
